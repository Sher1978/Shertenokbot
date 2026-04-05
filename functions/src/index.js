const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { Telegraf } = require('telegraf');
const ai = require('./ai');
const { OWNER_ID } = require('./ai');
const { getSecret } = require('./secrets');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { 
    trackUsage, 
    checkImageCooldown, 
    updateLastJokeTime, 
    getAllUserProfiles, 
    getTasksDueSoon, 
    updateUserProfile 
} = require('./db');
const { getRandomJoke } = require('./jokes');

// Ответ чужаку: вежливо-недоверчивый шаблон в стиле Штирлица
const STRANGER_RESPONSES = [
    'Штирлиц внезапно осознал, что его никто не предупредил.\n\nПароль?',
    'Остановитесь. Кто вас направил?\n\nИнструкции: назовите секретную фразу.',
    'Штирлиц смотрел на экран. Потом посмотрел ещё раз. Это точно был не Центр.\nСообщите кодовое слово.',
];
const STRANGER_REDIRECT = [
    'Проверка не пройдена. По вопросам доступа обращайтесь в канцелярию за бумагой. Или напрямую к Штандартенфюреру @Sherlockdxb. Он всё решит.',
    'Штирлиц закурил. Неправильный пароль — очевидный провал. За бумагой — к Штандартенфюреру @Sherlockdxb.',
    'Полномочий не предъявлены. Связьтесь с Штандартенфюрером @Sherlockdxb — он выдаст допуск.',
];
const STRANGER_SILENCE = [
    'Штирлиц знал: экономия — это не только когда мало тратишь, но и когда не даешь тратить другим.',
    'Краткость — признак настоящего разведчика.',
    'Разговор окончен. Штирлиц ушел в глубокое подполье.',
    'Связь прервана. Передатчик Плейшнера перегрелся.',
    'Явка провалена. Заходите в другой раз.',
];

const OLGA_ID = '670008812';

function isStranger(ctx) {
    const uid = ctx.from.id.toString();
    return uid !== OWNER_ID && uid !== OLGA_ID;
}

function replyStranger(ctx) {
    const r = STRANGER_RESPONSES[Math.floor(Math.random() * STRANGER_RESPONSES.length)];
    const d = STRANGER_REDIRECT[Math.floor(Math.random() * STRANGER_REDIRECT.length)];
    return ctx.reply(`${r}\n\n${d}`);
}

let botInstance = null;
// Force deploy timestamp: 2026-04-03 13:55 (Migration to new bot)


/**
 * Инициализирует бота асинхронно при первом вызове.
 */
async function getBot() {
    if (!botInstance) {
        try {
            console.log("[Bot] Initializing Telegraf instance...");
            const token = await getSecret('TELEGRAM_BOT_TOKEN');
            
            botInstance = new Telegraf(token);

            // Системный маппинг групп изображений (расширенная библиотека)
            const IMAGE_GROUPS = {
                'intel': [
                    'thinking.png', 'investigation.png',
                    'lib/intel/intel_0.jpg', 'lib/intel/intel_1.jpg', 'lib/intel/intel_2.jpg', 'lib/intel/intel_3.jpg',
                    'lib/intel/intel_4.jpg', 'lib/intel/intel_5.jpg', 'lib/intel/intel_6.png', 'lib/intel/intel_7.jpg'
                ],
                'relax': [
                    'welcome.png', 'waiting.png',
                    'lib/relax/relax_0.jpg', 'lib/relax/relax_1.webp', 'lib/relax/relax_2.jpg', 'lib/relax/relax_3.jpg',
                    'lib/relax/relax_4.jpg', 'lib/relax/relax_5.jpg', 'lib/relax/relax_6.jpg', 'lib/relax/relax_7.webp'
                ],
                'oper': [
                    'briefing.png', 'surveillance.png', 'transit.png',
                    'lib/oper/oper_0.jpg', 'lib/oper/oper_1.jpg', 'lib/oper/oper_2.jpeg', 'lib/oper/oper_3.jpg',
                    'lib/oper/oper_4.jpg', 'lib/oper/oper_5.webp', 'lib/oper/oper_6.jpg', 'lib/oper/oper_7.webp'
                ],
                'crisis': [
                    'bad_news.png', 'crisis.png', 'important.png',
                    'lib/crisis/crisis_0.jpg', 'lib/crisis/crisis_1.jpg', 'lib/crisis/crisis_2.jpg', 'lib/crisis/crisis_3.jpg',
                    'lib/crisis/crisis_4.jpg', 'lib/crisis/crisis_5.jpg', 'lib/crisis/crisis_6.jpg', 'lib/crisis/crisis_7.jpg'
                ],
                'arch': [
                    'authority.png', 'searching.png',
                    'lib/arch/arch_0.webp', 'lib/arch/arch_1.jpg', 'lib/arch/arch_2.jpg', 'lib/arch/arch_3.jpg',
                    'lib/arch/arch_4.jpg', 'lib/arch/arch_5.jpg', 'lib/arch/arch_6.jpg'
                ]
            };

            // Маппинг старых тегов к новым группам (для обратной совместимости)
            const OLD_TAGS_MAP = {
                'welcome': 'relax', 'thinking': 'intel', 'searching': 'arch',
                'briefing': 'oper', 'investigation': 'intel', 'authority': 'arch',
                'crisis': 'crisis', 'important': 'crisis', 'surveillance': 'oper',
                'transit': 'oper', 'waiting': 'relax', 'bad_news': 'crisis'
            };

            // Helper for situational photos (updated with random library select)
            const sendPhotoIfNeeded = async (ctx, response) => {
                const userId = ctx.from.id.toString();
                // Более гибкий поиск тега: [IMAGE: key] или просто [key]
                const match = response.match(/\[(?:IMAGE:\s*)?(\w+)\]/i);
                
                if (match) {
                    let tag = match[1].toLowerCase();
                    const category = OLD_TAGS_MAP[tag] || (IMAGE_GROUPS[tag] ? tag : null);

                    if (category) {
                        const group = IMAGE_GROUPS[category];
                        if (group && group.length > 0) {
                            const randomImage = group[Math.floor(Math.random() * group.length)];
                            const photoPath = path.join(__dirname, 'assets', randomImage);
                            const canSend = await checkImageCooldown(userId, category);

                            if (canSend && fs.existsSync(photoPath)) {
                                try {
                                    await ctx.replyWithPhoto({ source: photoPath });
                                    console.log(`[Bot] Sent random image ${randomImage} from category ${category}`);
                                } catch (e) {
                                    console.error(`Failed to send photo: ${randomImage}`, e);
                                }
                            } else if (!canSend) {
                                console.log(`[Bot] Category ${category} is on cooldown for user ${userId}. Skipping binary send.`);
                            }
                        }
                        
                        // Всегда убираем тег из текста, если это был валидный тег категории
                        return response.replace(/\[(?:IMAGE:\s*)?\w+\]/gi, '').trim();
                    }
                }
                return response;
            };

            const getMskTime = () => new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

            try {
                // Set bot persona metadata
                await botInstance.telegram.setMyDescription("Штирлиц — ваш оперативный помощник. Разведка, планирование, отчетность. Связь с Центром установлена.");
                await botInstance.telegram.setMyShortDescription("Оперативный помощник Штирлиц. Разведка и планирование.");
            } catch (e) {
                console.error("Failed to set bot info:", e);
            }

            // Регистрируем меню команд без await — fire-and-forget, не блокирует cold start
            botInstance.telegram.setMyCommands([
                { command: 'wake',     description: '⚡ Разбудить Штирлица' },
                { command: 'start',    description: 'Запустить бота' },
                { command: 'projects', description: 'Список всех проектов' },
                { command: 'tasks',    description: 'Список активных задач' },
                { command: 'status',   description: 'Полный срез по проектам' },
                { command: 'usage',    description: 'Статистика трат и запросов' },
                { command: 'help',     description: 'Как пользоваться ботом' }
            ]).catch(e => console.warn('[Bot] setMyCommands failed (non-critical):', e.message));

            // /wake — мгновенный ответ без AI, чтобы "разбудить" функцию
            botInstance.command('wake', (ctx) => ctx.reply('⚡ Штирлиц здесь! Готов к работе. Можешь писать.'));

            const googleService = require('./google');
            const db = require('./db');

            botInstance.start(async (ctx) => {
                const userId = ctx.from.id.toString();
                if (isStranger(ctx)) return replyStranger(ctx);

                try {
                    const profile = await db.getUserProfile(userId);
                    let welcomeMsg = "";
                    
                    // Инициализация папки на Диске, если её нет
                    if (!profile.googleDriveFolderId) {
                        try {
                            console.log(`[Onboarding] Initializing first-time user: ${userId}`);
                            await ctx.reply("🧥 Штирлиц подготавливает вашу явку... Секунду.");
                            
                            const folderName = userId === OWNER_ID ? "Stirlitz_Archive_Admin" : `Stirlitz_Archive_Kat`;
                            const folder = await googleService.createProjectFolder(folderName);
                            
                            // Сохраняем ID папки сразу
                            await db.updateUserProfile(userId, { 
                                googleDriveFolderId: folder.id,
                                initializedAt: new Date().toISOString()
                            });
                            
                            // Создаем файл приветствия/памяти и прошивку
                            await googleService.createFile("Stirlitz_Memory.md", `# Личное дело\nДата создания: ${new Date().toISOString()}\n\nЭто ваша оперативная память.\n`, folder.id);
                            await googleService.createFile("Stirlitz_Core.md", `- Основная директива инициализирована.\n`, folder.id);
                            
                            if (userId === OLGA_ID) {
                                welcomeMsg = "🧥 Оля, приветствую! В целях конспирации здесь я буду называть тебя Фрау Кэт (или Радистка Кэт).\n\n" +
                                             "Я подготовил для тебя защищенную папку в облаке. Я могу:\n" +
                                             "- Планировать твои дела (команда /tasks)\n" +
                                             "- Вести твои проекты (/projects)\n" +
                                             "- Сохранять документы на Google Диск\n" +
                                             "- Следить за твоим календарем.\n\n" +
                                             "⚠️ **Важно:** Чтобы я видел твой календарь, поделись им (режим Chmod: Просмотр) с моим сервисным адресом:\n" +
                                             "`stirlitz-service@sarafun-f9616.iam.gserviceaccount.com`";
                            } else {
                                welcomeMsg = "🧥 Центр, связь установлена. Личный архив подготовлен. Готов к выполнению оперативных задач.";
                            }
                        } catch (initErr) {
                            console.error(`[Onboarding] Initialization FAILED:`, initErr);
                            return ctx.reply(`🧥 Докладываю: возникла заминка при подготовке архива. [ERR] ${initErr.message}`);
                        }
                    } else {
                        welcomeMsg = userId === OLGA_ID ? "🧥 Фрау Кэт, рад снова вас слышать. Какие будут поручения?" : "🧥 Слушаю, Центр. Докладывайте обстановку.";
                    }

                    const photoPath = path.join(__dirname, 'welcome.png');
                    if (fs.existsSync(photoPath)) {
                        await ctx.replyWithPhoto({ source: fs.createReadStream(photoPath) }, { caption: welcomeMsg, parse_mode: 'Markdown' });
                    } else {
                        await ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
                    }

                    // Отправляем email сервисного аккаунта для настройки календаря (только при первом старте или по запросу)
                    if (!profile.googleCalendarId || welcomeMsg.includes("сервисным адресом")) {
                        const serviceAccount = parseJsonSecret(await getSecret('GOOGLE_SERVICE_ACCOUNT_JSON'));
                        if (serviceAccount && serviceAccount.client_email) {
                            await ctx.reply(`📫 Адрес для доступа к календарю:\n\`${serviceAccount.client_email}\`\n\nПросто добавьте его в настройки доступа вашего Google Календаря.`, { parse_mode: 'Markdown' });
                        }
                    }

                } catch (err) {
                    console.error("Start command error:", err);
                    await ctx.reply("🧥 Произошла заминка при подготовке документов. Попробуйте позже.");
                }
            });
            
            botInstance.command('projects', async (ctx) => {
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                const response = await ai.processMessage(ctx.from.id.toString(), "Покажи мои проекты.", null, getMskTime());
                await ctx.reply(response);
            });

            botInstance.command('tasks', async (ctx) => {
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                const response = await ai.processMessage(ctx.from.id.toString(), "Покажи мои активные задачи.", null, getMskTime());
                await ctx.reply(response);
            });
            botInstance.command('status', async (ctx) => {
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                const response = await ai.processMessage(ctx.from.id.toString(), "Сделай полный аудит по всем моим проектам и задачам.", null, getMskTime());
                await ctx.reply(response);
            });
            
            botInstance.command('usage', async (ctx) => {
                if (isStranger(ctx)) return;
                
                const now = new Date();
                const dateStr = now.toISOString().split('T')[0];
                const stats = await getDailyStats(dateStr);
                
                const emoji = parseFloat(stats.estimatedCost) > 1.0 ? '🚨' : '🟢';
                
                let msg = `💰 **Оперативный отчет по расходам (${dateStr})**\n\n`;
                msg += `👤 Штирлиц (Вы): ${stats.admin} запросов\n`;
                msg += `👥 Гости: ${stats.guests} запросов\n`;
                msg += `📈 Итого: ${stats.total} запросов\n\n`;
                msg += `${emoji} **Оценочная стоимость: ~$${stats.estimatedCost}**\n`;
                msg += `_(При расчете: 2000 токенов/запрос, модель Flash)_\n\n`;
                msg += `Центр, напоминаю: жесткий лимит в $10 установлен в Google Console. Мы в безопасности.`;
                
                await ctx.reply(msg, { parse_mode: 'Markdown' });
            });

            botInstance.on('text', async (ctx) => {
                if (isStranger(ctx)) {
                    const { canAnswer, limitReached } = await trackUsage(ctx.from.id.toString(), true);
                    if (!canAnswer) return; // Молчание
                    await replyStranger(ctx);
                    if (limitReached) {
                        const s = STRANGER_SILENCE[Math.floor(Math.random() * STRANGER_SILENCE.length)];
                        await ctx.reply(`🧥 ${s}`);
                    }
                    return;
                }

                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                try {
                    let userMessage = ctx.message.text;
                    const userId = ctx.from.id.toString();
                    const chatId = ctx.chat.id.toString();

                    // Сохраняем/обновляем chatId для проактивных уведомлений
                    await updateUserProfile(userId, { chatId });

                    // Проактивный юмор: проверяем кулдаун (раз в 30 мин)
                    if (await canSendJoke(userId)) {
                        const blacklist = await getGlobalBlacklist();
                        const joke = getRandomJoke(blacklist);
                        if (joke) {
                            console.log(`[Joke] Injecting proactive joke for user ${userId}`);
                            userMessage += `\n\n[SYSTEM: Центр требует разрядки обстановки. Расскажи этот анекдот про Штирлица в своем стиле: "${joke}"]`;
                            await updateLastJokeTime(userId);
                        }
                    }

                    let response = await ai.processMessage(userId, userMessage, null, getMskTime());
                    response = await sendPhotoIfNeeded(ctx, response);
                    await ctx.reply(response);
                } catch (e) {
                    console.error("AI processing error:", e);
                    await ctx.reply("Ошибка обработки ИИ.");
                }
            });

            const downloadFile = async (fileId) => {
                const link = await botInstance.telegram.getFileLink(fileId);
                const response = await axios.get(link.href, { responseType: 'arraybuffer' });
                return Buffer.from(response.data).toString('base64');
            };

            botInstance.on('document', async (ctx) => {
                if (isStranger(ctx)) {
                    const { canAnswer, limitReached } = await trackUsage(ctx.from.id.toString(), true);
                    if (!canAnswer) return;
                    await replyStranger(ctx);
                    if (limitReached) {
                        const s = STRANGER_SILENCE[Math.floor(Math.random() * STRANGER_SILENCE.length)];
                        await ctx.reply(`🧥 ${s}`);
                    }
                    return;
                }
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                try {
                    await ctx.reply("Секунду, изучаю документ...");
                    const userId = ctx.from.id.toString();
                    const chatId = ctx.chat.id.toString();
                    await updateUserProfile(userId, { chatId });

                    const fileId = ctx.message.document.file_id;
                    const mimeType = ctx.message.document.mime_type;
                    const base64 = await downloadFile(fileId);
                    
                    let response = await ai.processMessage(
                        ctx.from.id.toString(), 
                        ctx.message.caption || "Проанализируй этот документ.",
                        { mimeType, data: base64 },
                        getMskTime()
                    );
                    response = await sendPhotoIfNeeded(ctx, response);
                    await ctx.reply(response);
                } catch (e) {
                    console.error("Document processing error:", e);
                    await ctx.reply("Не удалось обработать документ.");
                }
            });

            botInstance.on('photo', async (ctx) => {
                if (isStranger(ctx)) {
                    const { canAnswer, limitReached } = await trackUsage(ctx.from.id.toString(), true);
                    if (!canAnswer) return;
                    await replyStranger(ctx);
                    if (limitReached) {
                        const s = STRANGER_SILENCE[Math.floor(Math.random() * STRANGER_SILENCE.length)];
                        await ctx.reply(`🧥 ${s}`);
                    }
                    return;
                }
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                try {
                    await ctx.reply("Смотри внимательно...");
                    const userId = ctx.from.id.toString();
                    const chatId = ctx.chat.id.toString();
                    await updateUserProfile(userId, { chatId });

                    // Берем самое крупное фото
                    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                    const base64 = await downloadFile(fileId);
                    
                    let response = await ai.processMessage(
                        ctx.from.id.toString(), 
                        ctx.message.caption || "Что на этом фото?",
                        { mimeType: 'image/jpeg', data: base64 },
                        getMskTime()
                    );
                    response = await sendPhotoIfNeeded(ctx, response);
                    await ctx.reply(response);
                } catch (e) {
                    console.error("Photo processing error:", e);
                    await ctx.reply("Не удалось обработать фото.");
                }
            });

            botInstance.on('voice', async (ctx) => {
                if (isStranger(ctx)) {
                    const { canAnswer, limitReached } = await trackUsage(ctx.from.id.toString(), true);
                    if (!canAnswer) return;
                    await replyStranger(ctx);
                    if (limitReached) {
                        const s = STRANGER_SILENCE[Math.floor(Math.random() * STRANGER_SILENCE.length)];
                        await ctx.reply(`🧥 ${s}`);
                    }
                    return;
                }
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                try {
                    await ctx.reply("Слушаю...");
                    const fileId = ctx.message.voice.file_id;
                    const base64 = await downloadFile(fileId);
                    
                    const response = await ai.processMessage(
                        ctx.from.id.toString(), 
                        ctx.message.caption || "Слушай внимательно это голосовое сообщение и ответь пользователю.",
                        { mimeType: 'audio/ogg', data: base64 }
                    );
                    await ctx.reply(response);
                } catch (e) {
                    console.error("Voice processing error:", e);
                    await ctx.reply("Не удалось обработать голосовое сообщение.");
                }
            });

            botInstance.on('audio', async (ctx) => {
                if (isStranger(ctx)) {
                    const { canAnswer, limitReached } = await trackUsage(ctx.from.id.toString(), true);
                    if (!canAnswer) return;
                    await replyStranger(ctx);
                    if (limitReached) {
                        const s = STRANGER_SILENCE[Math.floor(Math.random() * STRANGER_SILENCE.length)];
                        await ctx.reply(`🧥 ${s}`);
                    }
                    return;
                }
                const { warning } = await trackUsage(ctx.from.id.toString(), false);
                if (warning) {
                    await ctx.reply("🧥 Штирлиц, Центр сообщает: лимит бесплатных шифровок на исходе (использовано 1300 из 1500). Пора экономить.");
                }
                try {
                    await ctx.reply("Изучаю аудиозапись...");
                    const fileId = ctx.message.audio.file_id;
                    const mimeType = ctx.message.audio.mime_type || 'audio/mpeg';
                    const base64 = await downloadFile(fileId);
                    
                    const response = await ai.processMessage(
                        ctx.from.id.toString(), 
                        ctx.message.caption || "Проанализируй эту аудиозапись.",
                        { mimeType, data: base64 }
                    );
                    await ctx.reply(response);
                } catch (e) {
                    console.error("Audio processing error:", e);
                    await ctx.reply("Не удалось обработать аудио-файл.");
                }
            });

            console.log("[Bot] Initialization complete.");
        } catch (err) {
            console.error("[Bot] Initialization failed:", err);
            throw err;
        }
    }
    return botInstance;
}

// Экспортируем функцию с упрощенной конфигурацией
exports.bot = onRequest({ 
    region: "us-central1",
    memory: "256MiB",
    maxInstances: 10,
    secrets: ["GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON"]
}, async (req, res) => {
    try {
        const bot = await getBot();
        return await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(500).send("Internal Server Error or 404 in Telegram Token");
    }
});

// --- ПРОАКТИВНЫЙ ПЛАНИРОВЩИК (SCHEDULER) ---
// Запускается каждый час для проверки дедлайнов и подготовки сводок.
exports.scheduledMessenger = onSchedule({
    schedule: "0 * * * *", // Раз в час
    timeZone: "Europe/Moscow",
    memory: "512MiB",
    secrets: ["GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON"]
}, async (event) => {
    console.log("[Scheduler] Tick started at:", new Date().toISOString());
    const bot = await getBot();
    const users = await getAllUserProfiles();
    
    // Получаем текущий час в МСК
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', timeZone: 'Europe/Moscow', hour12: false });
    const currentHour = parseInt(formatter.format(now));
    
    for (const user of users) {
        if (!user.chatId) continue;
        const userId = user.id;

        try {
            // 1. ПРОВЕРКА ДЕДЛАЙНОВ (Каждый час)
            const dueTasks = await getTasksDueSoon(userId, 2);
            if (dueTasks.length > 0) {
                const taskTitles = dueTasks.map(t => `«${t.title}»`).join(', ');
                const remindPrompt = `[SYSTEM: Центр сообщает, что дедлайны по задачам (${taskTitles}) подходят к концу (осталось менее 2 часов). Подготовь оперативное напоминание.]`;
                
                const response = await ai.processMessage(userId, remindPrompt, null, getMskTime());
                await bot.telegram.sendMessage(user.chatId, response);
                console.log(`[Scheduler] Deadline reminder sent to ${userId}`);
            }

            // 2. ОПЕРАТИВНЫЕ СВОДКИ (10:00, 14:00, 21:00 по МСК)
            let summaryType = null;
            if (currentHour === 10) summaryType = "УТРЕННЯЯ ПРИВЕТСТВЕННАЯ СВОДКА (планы на день)";
            else if (currentHour === 14) summaryType = "ОБЕДЕННЫЙ СТАТУС (промежуточные итоги)";
            else if (currentHour === 21) summaryType = "ВЕЧЕРНИЙ ОТЧЕТ (итоги дня и планы на завтра)";

            if (summaryType) {
                const summaryPrompt = `[SYSTEM: Пришло время для регулярной активности: ${summaryType}. Обратись к пользователю в своем стиле, подведи итоги или обозначь планы на день на основе данных из памяти.]`;
                const response = await ai.processMessage(userId, summaryPrompt, null, getMskTime());
                await bot.telegram.sendMessage(user.chatId, response);
                console.log(`[Scheduler] ${summaryType} sent to ${userId}`);
            }

        } catch (err) {
            console.error(`[Scheduler] Failed to process user ${userId}:`, err);
        }
    }
    console.log("[Scheduler] Tick finished.");
});
