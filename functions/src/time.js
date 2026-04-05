const { DateTime } = require('luxon');

/**
 * Получает текущее время в указанном часовом поясе.
 * @param {string} zone 
 * @returns {DateTime}
 */
function now(zone = 'Europe/Moscow') {
    return DateTime.now().setZone(zone);
}

/**
 * Проверяет, попадает ли текущее время в "окно" для уведомления.
 * Мы проверяем, прошло ли запланированное время, но не более чем на 1 час назад,
 * и не отправляли ли мы уже уведомление сегодня.
 * 
 * @param {DateTime} userNow Текущее время пользователя
 * @param {string} targetTime Время в формате "HH:mm"
 * @param {string} lastSentIso Дата последнего отправления (ISO)
 * @returns {boolean}
 */
function isSlotMatch(userNow, targetTime, lastSentIso) {
    if (!targetTime) return false;

    const [hour, minute] = targetTime.split(':').map(Number);
    const target = userNow.set({ hour, minute, second: 0, millisecond: 0 });

    // Если сейчас раньше, чем целевое время — не время
    if (userNow < target) return false;

    // Если прошло больше часа с целевого времени — окно закрыто (чтобы не спамить старыми)
    if (userNow > target.plus({ hours: 1 })) return false;

    // Если уже отправляли сегодня — пропускаем
    if (lastSentIso) {
        const lastSent = DateTime.fromISO(lastSentIso).setZone(userNow.zoneName);
        if (lastSent.hasSame(userNow, 'day')) {
            return false;
        }
    }

    return true;
}

/**
 * Парсит дедлайн и возвращает объект DateTime или null.
 * @param {string} deadlineStr 
 * @param {string} zone 
 * @returns {DateTime|null}
 */
function parseDeadline(deadlineStr, zone = 'Europe/Moscow') {
    if (!deadlineStr) return null;
    const dt = DateTime.fromISO(deadlineStr).setZone(zone);
    return dt.isValid ? dt : null;
}

module.exports = {
    now,
    isSlotMatch,
    parseDeadline
};
