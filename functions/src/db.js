const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// В среде Firebase Cloud Functions приложение инициализируется автоматически без ключей
initializeApp();
const db = getFirestore();

async function getDb() {
    // В Firestore мы не читаем всю базу сразу, но для совместимости с прошлым кодом:
    const projectsSnap = await db.collection('projects').get();
    const tasksSnap = await db.collection('tasks').get();
    
    return {
        projects: projectsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        tasks: tasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    };
}

// Заменяем saveDb на точечные обновления Firestore для эффективности
async function addTask(task) {
    const res = await db.collection('tasks').add(task);
    return res.id;
}

async function addProject(project) {
    const res = await db.collection('projects').doc(project.name).set(project, { merge: true });
    return project.name;
}

async function updateTask(taskId, updates) {
    await db.collection('tasks').doc(taskId).update(updates);
}

// История сообщений (контекст AI)
async function getHistory(userId) {
    const snap = await db.collection('history').doc(userId).get();
    if (!snap.exists) return [];
    return snap.data().messages || [];
}

async function addHistory(userId, role, text) {
    const docRef = db.collection('history').doc(userId);
    const snap = await docRef.get();
    let messages = snap.exists ? (snap.data().messages || []) : [];
    
    messages.push({ role, parts: [{ text }] });
    if (messages.length > 20) messages = messages.slice(-20);
    
    await docRef.set({ messages }, { merge: true });
}

// Записывает сразу несколько сообщений за одну пару read/write
async function addHistoryBatch(userId, newMessages) {
    const docRef = db.collection('history').doc(userId);
    const snap = await docRef.get();
    let messages = snap.exists ? (snap.data().messages || []) : [];
    
    messages.push(...newMessages);
    if (messages.length > 20) messages = messages.slice(-20);
    
    await docRef.set({ messages }, { merge: true });
}

// Профиль пользователя (долгосрочная память)
async function getUserProfile(userId) {
    const snap = await db.collection('user_profile').doc(userId).get();
    if (!snap.exists) return {};
    return snap.data() || {};
}

async function updateUserProfile(userId, updates) {
    await db.collection('user_profile').doc(userId).set(updates, { merge: true });
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
    updateUserProfile
};
