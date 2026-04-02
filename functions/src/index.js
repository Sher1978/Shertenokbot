const { onRequest } = require('firebase-functions/v2/https');
const { Telegraf } = require('telegraf');
const ai = require('./ai');
const { getSecret } = require('./secrets');

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

            // Настраиваем команды
            await botInstance.telegram.setMyCommands([
                { command: 'start', description: 'Запустить бота' },
                { command: 'projects', description: 'Список всех проектов' },
                { command: 'tasks', description: 'Список активных задач' },
                { command: 'status', description: 'Полный срез' },
                { command: 'help', description: 'Как пользоваться ботом' }
            ]);

            botInstance.start((ctx) => ctx.reply('Привет! Твой системный компаньон Гексли. Я готов в облаке!'));
            
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
                try {
                    const response = await ai.processMessage(ctx.from.id.toString(), ctx.message.text);
                    await ctx.reply(response);
                } catch (e) {
                    console.error("AI processing error:", e);
                    await ctx.reply("Ошибка обработки ИИ.");
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
    maxInstances: 10
}, async (req, res) => {
    try {
        const bot = await getBot();
        return await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error("Webhook Error:", err.message);
        return res.status(500).send("Internal Server Error or 404 in Telegram Token");
    }
});


