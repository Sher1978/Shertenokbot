const { onRequest } = require('firebase-functions/v2/https');
const { Telegraf } = require('telegraf');
const ai = require('./ai');
const { OWNER_ID } = require('./ai');
const { getSecret } = require('./secrets');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { trackUsage } = require('./db');

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

function isStranger(ctx) {
    return OWNER_ID !== 'REPLACE_WITH_YOUR_TELEGRAM_ID' && ctx.from.id.toString() !== OWNER_ID;
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

            // Helper for situational photos
            const sendPhotoIfNeeded = async (ctx, response) => {
                const match = response.match(/\[IMAGE:\s*(\w+)\]/);
                if (match) {
                    const key = match[1];
                    const photoPath = path.join(__dirname, 'assets', `${key}.png`);
                    if (fs.existsSync(photoPath)) {
                        try {
                            await ctx.replyWithPhoto({ source: photoPath });
                        } catch (e) {
                            console.error(`Failed to send photo: ${key}`, e);
                        }
                    }
                    return response.replace(/\[IMAGE:\s*\w+\]/g, '').trim();
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
                { command: 'help',     description: 'Как пользоваться ботом' }
            ]).catch(e => console.warn('[Bot] setMyCommands failed (non-critical):', e.message));

            // /wake — мгновенный ответ без AI, чтобы "разбудить" функцию
            botInstance.command('wake', (ctx) => ctx.reply('⚡ Штирлиц здесь! Готов к работе. Можешь писать.'));

            botInstance.start(async (ctx) => {
                const photoPath = path.join(__dirname, 'welcome.png');
                if (fs.existsSync(photoPath)) {
                    await ctx.replyWithPhoto({ source: fs.createReadStream(photoPath) }, {
                        caption: '🧥 Штирлиц смотрел на вас долгим, немигающим взглядом. \n\n— Приветствую. Я Штирлиц, ваш связной в облаке. Докладывайте обстановку.'
                    });
                } else {
                    await ctx.reply('Привет! Твой системный компаньон Штирлиц. Я готов в облаке!');
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
                    let response = await ai.processMessage(ctx.from.id.toString(), ctx.message.text, null, getMskTime());
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
    secrets: ["GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN"]
}, async (req, res) => {
    try {
        const bot = await getBot();
        return await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(500).send("Internal Server Error or 404 in Telegram Token");
    }
});


