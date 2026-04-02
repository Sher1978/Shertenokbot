const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const { Telegraf } = require('telegraf');
const ai = require('./ai');

// Определяем секреты (они будут загружены из Google Cloud Secret Manager)
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GOOGLE_SERVICE_ACCOUNT_JSON = defineSecret('GOOGLE_SERVICE_ACCOUNT_JSON');

let botInstance = null;

function getBot() {
    if (!botInstance) {
        const token = TELEGRAM_BOT_TOKEN.value();
        if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing!");
        botInstance = new Telegraf(token);

        // Настраиваем команды
        botInstance.telegram.setMyCommands([
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
                console.error(e);
                await ctx.reply("Ошибка обработки.");
            }
        });
    }
    return botInstance;
}

// Экспортируем функцию с явным указанием секретов
exports.bot = onRequest({ 
    region: "us-central1",
    secrets: [TELEGRAM_BOT_TOKEN, GEMINI_API_KEY] 
}, async (req, res) => {
    try {
        const bot = getBot();
        return await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error("Webhook Error:", err);
        return res.status(500).send("Internal Server Error");
    }
});

