// Trigger deploy: 2026-04-03 (All permissions granted)
const { onRequest } = require('firebase-functions/v2/https');



const { Telegraf } = require('telegraf');
const ai = require('./ai');

// В Firebase Cloud Functions используем переменные окружения из Config или Process.env
// Рекомендуется задать их через: firebase functions:secrets:set TELEGRAM_BOT_TOKEN ...
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Установка команд (можно вызвать один раз при деплое или через отдельный скрипт)
bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота' },
    { command: 'projects', description: 'Список всех проектов' },
    { command: 'tasks', description: 'Список активных задач' },
    { command: 'status', description: 'Полный срез' },
    { command: 'help', description: 'Как пользоваться ботом' }
]);

bot.start((ctx) => ctx.reply('Привет! Твой системный компаньон в облаке Firebase. Я готов!'));

bot.command('projects', async (ctx) => {
    const response = await ai.processMessage(ctx.from.id.toString(), "Дай мне список всех моих текущих проектов.");
    await ctx.reply(response);
});

bot.command('tasks', async (ctx) => {
    const response = await ai.processMessage(ctx.from.id.toString(), "Какие задачи у меня сейчас в списке дел?");
    await ctx.reply(response);
});

bot.command('status', async (ctx) => {
    const response = await ai.processMessage(ctx.from.id.toString(), "Сделай полный аудит по всем моим проектам и задачам.");
    await ctx.reply(response);
});

bot.on('text', async (ctx) => {
    try {
        const response = await ai.processMessage(ctx.from.id.toString(), ctx.message.text);
        await ctx.reply(response);
    } catch (e) {
        console.error(e);
        await ctx.reply("Ошибка обработки.");
    }
});

// Экспортируем функцию для Firebase
exports.bot = onRequest(async (req, res) => {
    await bot.handleUpdate(req.body, res);
});
