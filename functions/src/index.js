const { onRequest } = require('firebase-functions/v2/https');
const { Telegraf } = require('telegraf');
const ai = require('./ai');
const { OWNER_ID } = require('./ai');
const { getSecret } = require('./secrets');
const axios = require('axios');

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

function isStranger(ctx) {
    return OWNER_ID !== 'REPLACE_WITH_YOUR_TELEGRAM_ID' && ctx.from.id.toString() !== OWNER_ID;
}

function replyStranger(ctx) {
    const r = STRANGER_RESPONSES[Math.floor(Math.random() * STRANGER_RESPONSES.length)];
    const d = STRANGER_REDIRECT[Math.floor(Math.random() * STRANGER_REDIRECT.length)];
    return ctx.reply(`${r}\n\n${d}`);
}

let botInstance = null;
// Force deploy timestamp: 2026-04-03 02:02


/**
 * Инициализирует бота асинхронно при первом вызове.
 */
async function getBot() {
    if (!botInstance) {
        try {
            console.log("[Bot] Initializing Telegraf instance...");
            const token = await getSecret('TELEGRAM_BOT_TOKEN');
            
            botInstance = new Telegraf(token);

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

            botInstance.start((ctx) => ctx.reply('Привет! Твой системный компаньон Штирлиц. Я готов в облаке!'));
            
            botInstance.command('projects', async (ctx) => {
                const response = await ai.processMessage(ctx.from.id.toString(), "Покажи мои проекты.");
                await ctx.reply(response);
            });

            botInstance.command('tasks', async (ctx) => {
                const response = await ai.processMessage(ctx.from.id.toString(), "Покажи мои активные задачи.");
                await ctx.reply(response);
            });

            botInstance.command('status', async (ctx) => {
                const response = await ai.processMessage(ctx.from.id.toString(), "Сделай полный аудит по всем моим проектам и задачам.");
                await ctx.reply(response);
            });

            botInstance.on('text', async (ctx) => {
                if (isStranger(ctx)) return replyStranger(ctx);
                try {
                    const response = await ai.processMessage(ctx.from.id.toString(), ctx.message.text);
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
                if (isStranger(ctx)) return replyStranger(ctx);
                try {
                    await ctx.reply("Секунду, изучаю документ...");
                    const fileId = ctx.message.document.file_id;
                    const mimeType = ctx.message.document.mime_type;
                    const base64 = await downloadFile(fileId);
                    
                    const response = await ai.processMessage(
                        ctx.from.id.toString(), 
                        ctx.message.caption || "Проанализируй этот документ.",
                        { mimeType, data: base64 }
                    );
                    await ctx.reply(response);
                } catch (e) {
                    console.error("Document processing error:", e);
                    await ctx.reply("Не удалось обработать документ.");
                }
            });

            botInstance.on('photo', async (ctx) => {
                if (isStranger(ctx)) return replyStranger(ctx);
                try {
                    await ctx.reply("Смотри внимательно...");
                    // Берем самое крупное фото
                    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                    const base64 = await downloadFile(fileId);
                    
                    const response = await ai.processMessage(
                        ctx.from.id.toString(), 
                        ctx.message.caption || "Что на этом фото?",
                        { mimeType: 'image/jpeg', data: base64 }
                    );
                    await ctx.reply(response);
                } catch (e) {
                    console.error("Photo processing error:", e);
                    await ctx.reply("Не удалось обработать фото.");
                }
            });

            botInstance.on('voice', async (ctx) => {
                if (isStranger(ctx)) return replyStranger(ctx);
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
                if (isStranger(ctx)) return replyStranger(ctx);
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


