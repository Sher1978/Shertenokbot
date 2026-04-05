const { getApp, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let dbInstance = null;

function getFirestoreDb() {
    if (!dbInstance) {
        if (getApps().length === 0) {
            initializeApp();
        }
        dbInstance = getFirestore();
    }
    return dbInstance;
}

async function getDb() {
    // В Firestore мы не читаем всю базу сразу, но для совместимости с прошлым кодом:
    const projectsSnap = await getFirestoreDb().collection('projects').get();
    const tasksSnap = await getFirestoreDb().collection('tasks').get();
    
    return {
        projects: projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        tasks: tasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    };
}

// Заменяем saveDb на точечные обновления Firestore для эффективности
async function addTask(task) {
    const res = await getFirestoreDb().collection('tasks').add(task);
    return res.id;
}

async function addProject(project) {
    const res = await getFirestoreDb().collection('projects').doc(project.name).set(project, { merge: true });
    return project.name;
}

async function updateTask(taskId, updates) {
    await getFirestoreDb().collection('tasks').doc(taskId).update(updates);
}

// История сообщений (контекст AI)
async function getHistory(userId) {
    const snap = await getFirestoreDb().collection('history').doc(userId).get();
    if (!snap.exists) return [];
    return snap.data().messages || [];
}

async function addHistory(userId, role, text) {
    const docRef = getFirestoreDb().collection('history').doc(userId);
    const snap = await docRef.get();
    let messages = snap.exists ? (snap.data().messages || []) : [];
    
    messages.push({ role, parts: [{ text }] });
    if (messages.length > 20) messages = messages.slice(-20);
    
    await docRef.set({ messages }, { merge: true });
}

// Записывает сразу несколько сообщений за одну пару read/write
async function addHistoryBatch(userId, newMessages) {
    const docRef = getFirestoreDb().collection('history').doc(userId);
    const snap = await docRef.get();
    let messages = snap.exists ? (snap.data().messages || []) : [];
    
    messages.push(...newMessages);
    if (messages.length > 20) messages = messages.slice(-20);
    
    await docRef.set({ messages }, { merge: true });
}

// Профиль пользователя (долгосрочная память)
async function getUserProfile(userId) {
    const snap = await getFirestoreDb().collection('user_profile').doc(userId).get();
    if (!snap.exists) return {};
    return snap.data() || {};
}

async function updateUserProfile(userId, updates) {
    if (updates.chatId) {
        console.log(`[DB] Updating chatId for user ${userId}: ${updates.chatId}`);
    }
    await getFirestoreDb().collection('user_profile').doc(userId).set(updates, { merge: true });
}

/**
 * Получает все профили пользователей (для планировщика)
 * @returns {Promise<Object[]>}
 */
async function getAllUserProfiles() {
    const snap = await getFirestoreDb().collection('user_profile').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Получает задачи пользователя по статусу
 * @param {string} userId 
 * @param {string} status 'pending' или 'completed'
 * @returns {Promise<Object[]>}
 */
async function getTasksByStatus(userId, status = 'pending') {
    const snap = await getFirestoreDb().collection('tasks')
        .where('userId', '==', userId)
        .where('status', '==', status)
        .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function checkImageCooldown(userId, imageKey) {
    const docRef = getFirestoreDb().collection('user_profile').doc(userId);
    const now = Date.now();
    const cooldownMs = 15 * 60 * 1000;
    
    return await getFirestoreDb().runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        const data = snap.exists ? snap.data() : {};
        const cooldowns = data.imageCooldowns || {};
        const lastTime = cooldowns[imageKey] || 0;
        
        if (now - lastTime < cooldownMs) {
            return false; // На кулдауне
        }
        
        cooldowns[imageKey] = now;
        transaction.set(docRef, { imageCooldowns: cooldowns }, { merge: true });
        return true; // Можно отправлять
    });
}

/**
 * Трекинг использования для гостей и общего лимита
 * @param {string} userId
 * @param {boolean} isGuest
 * @returns {Promise<{canAnswer: boolean, warning: boolean}>}
 */
async function trackUsage(userId, isGuest) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // ГГГГ-ММ-ДД
    const minTimestamp = Math.floor(now.getTime() / 60000); // Текущая минута

    const globalRef = getFirestoreDb().collection('usage').doc('global_' + dateStr);
    const userRef = getFirestoreDb().collection('usage').doc(userId + '_' + dateStr);

    return await getFirestoreDb().runTransaction(async (transaction) => {
        const globalSnap = await transaction.get(globalRef);
        const userSnap = await transaction.get(userRef);

        let globalData = globalSnap.exists ? globalSnap.data() : { count: 0 };
        let userData = userSnap.exists ? userSnap.data() : { daily: 0, lastMin: 0, minCount: 0 };
        let limitReached = false;

        // 1. Проверка для гостя
        if (isGuest) {
            // Лимит по минутам (3/мин)
            if (userData.lastMin === minTimestamp) {
                if (userData.minCount >= 3) return { canAnswer: false, warning: false, limitReached: false };
                userData.minCount++;
                if (userData.minCount === 3) limitReached = true;
            } else {
                userData.lastMin = minTimestamp;
                userData.minCount = 1;
            }

            // Лимит по дням (10/день)
            if (userData.daily >= 10) return { canAnswer: false, warning: false, limitReached: false };
            userData.daily++;
            if (userData.daily === 10) limitReached = true;
        } else {
            // Для админа только инкрементим глобальный счетчик
            globalData.count = (globalData.count || 0) + 1;
        }

        // Обновляем данные
        transaction.set(globalRef, globalData, { merge: true });
        if (isGuest) {
            transaction.set(userRef, userData, { merge: true });
        }

        // Предупреждение админу
        const warning = !isGuest && globalData.count === 1300;

        return { canAnswer: true, warning, limitReached };
    });
}

/**
 * Получает статистику использования за конкретный день
 * @param {string} dateStr ГГГГ-ММ-ДД
 * @returns {Promise<{admin: number, totalGuests: number, estimatedCost: string}>}
 */
async function getDailyStats(dateStr) {
    const globalRef = getFirestoreDb().collection('usage').doc('global_' + dateStr);
    const globalSnap = await globalRef.get();
    const adminCount = globalSnap.exists ? (globalSnap.data().count || 0) : 0;
    
    // Считаем всех гостей (все документы, которые заканчиваются на _dateStr, но не global_)
    const usageSnap = await getFirestoreDb().collection('usage').get();
    let guestCount = 0;
    
    usageSnap.forEach(doc => {
        if (doc.id.endsWith('_' + dateStr) && !doc.id.startsWith('global_')) {
            guestCount += (doc.data().daily || 0);
        }
    });

    const total = adminCount + guestCount;
    // Примерная стоимость: 2000 токенов на запрос * $0.1 / 1M токенов (в среднем)
    const cost = (total * 2000 * (0.1 / 1000000)).toFixed(4);

    return {
        admin: adminCount,
        guests: guestCount,
        total: total,
        estimatedCost: cost
    };
}

/**
 * Получает глобальный черный список анекдотов
 * @returns {Promise<string[]>} Список текстов (или хешей) забаненных шуток
 */
async function getGlobalBlacklist() {
    const snap = await getFirestoreDb().collection('jokes_blacklist').get();
    return snap.docs.map(doc => doc.id); // Мы используем хеш/текст как ID
}

const crypto = require('crypto');

/**
 * Добавляет шутку в глобальный черный список
 * @param {string} jokeText 
 */
async function blacklistJoke(jokeText) {
    // Используем безопасный гексадецимальный хеш как ключ (base64 может содержать '/', ломающий пути Firestore)
    const jokeId = crypto.createHash('sha256').update(jokeText).digest('hex');
    await getFirestoreDb().collection('jokes_blacklist').doc(jokeId).set({
        text: jokeText,
        blacklistedAt: new Date().toISOString()
    });
}

/**
 * Проверяет, прошло ли достаточно времени с последней шутки (30 мин)
 * @param {string} userId 
 * @returns {Promise<boolean>} true если можно шутить
 */
async function canSendJoke(userId) {
    const profile = await getUserProfile(userId);
    const lastJokeTime = profile.lastJokeTime || 0;
    const now = Date.now();
    const interval = 30 * 60 * 1000; // 30 минут
    
    return (now - lastJokeTime > interval);
}

/**
 * Обновляет время последней шутки
 * @param {string} userId 
 */
async function updateLastJokeTime(userId) {
    await updateUserProfile(userId, { lastJokeTime: Date.now() });
}

/**
 * Получает задачи, дедлайн которых наступает в ближайшие N часов
 * @param {string} userId 
 * @param {number} hours 
 * @returns {Promise<Object[]>}
 */
async function getTasksDueSoon(userId, hours = 24) {
    const now = new Date();
    const future = new Date(now.getTime() + hours * 60 * 60 * 1000);
    
    const snap = await getFirestoreDb().collection('tasks')
        .where('userId', '==', userId)
        .where('status', '==', 'pending')
        .get();
    
    return snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(task => {
            if (!task.deadline) return false;
            const d = new Date(task.deadline);
            return d > now && d < future;
        });
}

module.exports = {
    getDb,
    addTask,
    addProject,
    updateTask,
    getHistory,
    addHistory,
    addHistoryBatch,
    getUserProfile,
    updateUserProfile,
    checkImageCooldown,
    trackUsage,
    getDailyStats,
    getGlobalBlacklist,
    blacklistJoke,
    canSendJoke,
    updateLastJokeTime,
    getAllUserProfiles,
    getTasksByStatus,
    getTasksDueSoon
};
