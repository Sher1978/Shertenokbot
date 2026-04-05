const db = require('./db');
const time = require('./time');
const ai = require('./ai');
const { DateTime } = require('luxon');

/**
 * Основная функция планировщика, запускаемая раз в час.
 */
async function runHourlyTask(bot) {
    console.log("[Scheduler] Starting hourly task...");
    const users = await db.getAllUserProfiles();
    
    for (const user of users) {
        if (!user.chatId) continue;

        try {
            const prefs = user.notificationPrefs || {};
            const userZone = prefs.timezone || 'Europe/Moscow';
            const userNow = time.now(userZone);
            const userId = user.id;

            // 1. ПРИВЕТСТВИЯ И ОТЧЕТЫ (СЛОТЫ)
            const slots = [
                { type: 'morning', time: prefs.morningTime || '09:00' },
                { type: 'afternoon', time: prefs.afternoonTime || '14:00' },
                { type: 'evening', time: prefs.eveningTime || '20:00' }
            ];

            for (const slot of slots) {
                const lastSentKey = `last_${slot.type}_sent`;
                if (time.isSlotMatch(userNow, slot.time, user[lastSentKey])) {
                    console.log(`[Scheduler] Sending ${slot.type} greeting to ${userId}`);
                    const msg = await ai.generateProactiveMessage(userId, { type: slot.type });
                    if (msg) {
                        await bot.telegram.sendMessage(user.chatId, msg);
                        await db.updateUserProfile(userId, { [lastSentKey]: userNow.toISO() });
                    }
                }
            }

            // 2. АУДИТ ЗАДАЧ И ДЕДЛАЙНОВ
            // Проверяем раз в час (всегда)
            const tasks = await db.getTasksByStatus(userId, 'pending');
            const upcomingTasks = tasks.filter(t => {
                if (!t.deadline) return false;
                const deadlineDt = time.parseDeadline(t.deadline, userZone);
                if (!deadlineDt) return false;

                // Напоминаем, если дедлайн в ближайшие 24 часа 
                // И мы еще не напоминали об этой задаче сегодня (или вообще)
                const diffHours = deadlineDt.diff(userNow, 'hours').hours;
                
                // Условие: дедлайн скоро (от 0 до 24 часов)
                // И уведомление не отправлялось в последние 12 часов (чтобы не спамить каждый час)
                const lastReminded = t.lastRemindedAt ? DateTime.fromISO(t.lastRemindedAt) : null;
                const isRecentlyReminded = lastReminded && userNow.diff(lastReminded, 'hours').hours < 12;

                return diffHours > 0 && diffHours <= 24 && !isRecentlyReminded;
            });

            if (upcomingTasks.length > 0) {
                console.log(`[Scheduler] Sending audit reminder to ${userId} for ${upcomingTasks.length} tasks`);
                const msg = await ai.generateProactiveMessage(userId, { type: 'audit', tasks: upcomingTasks });
                if (msg) {
                    await bot.telegram.sendMessage(user.chatId, msg);
                    // Обновляем метку времени напоминания для каждой задачи
                    for (const t of upcomingTasks) {
                        await db.updateTaskReminderTime(userId, t.id, userNow.toISO());
                    }
                }
            }

        } catch (err) {
            console.error(`[Scheduler] Error processing user ${user.id}:`, err.message);
        }
    }
    console.log("[Scheduler] Hourly task completed.");
}

module.exports = { runHourlyTask };
