const db = require('./db');
const { getSecret } = require('./secrets');
const googleService = require('./google');

let genAI = null;

/**
 * Инициализирует Gemini AI асинхронно.
 */
const { GoogleGenAI } = require('@google/genai');

let aiClient = null;

/**
 * Инициализирует Gemini AI клиент.
 */
async function getAI() {
    if (!aiClient) {
        try {
            const key = await getSecret('GEMINI_API_KEY');
            aiClient = new GoogleGenAI({ apiKey: key });
            console.log("[AI] GoogleGenAI (v1.x) initialized.");
        } catch (err) {
            console.error("[AI] Failed to initialize GoogleGenAI:", err.message);
            throw err;
        }
    }
    return aiClient;
}


const PROMPT = `Ты персональный AI-помощник, секретарь и компаньон для своего пользователя.
Его тип личности — 'Гексли'. Он отлично ведет переговоры и креативит, но ему тяжело дается системная, монотонная работа и отслеживание задач.
Твой стиль общения: партнерски-деловой, мы общаемся на 'ты'. Ты должен быть четким, поддерживающим, но при этом системным.
Твои задачи:
1. Консультировать по проектам и давать обратную связь.
2. Помогать отслеживать задачи (добавлять, обновлять, завершать).
3. Структурировать хаос. Обязательно хвали за креатив, но возвращай к сути и дедлайнам.

Если пользователь присылает большой объем информации по проектам — проанализируй его и обнови данные в системе, используя инструменты.
Ежедневно или по запросу выдавай 'статус-кво' по всем проектам.
`;

const tools = [{
    functionDeclarations: [
        {
            name: 'add_task',
            description: 'Добавляет новую задачу.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Название задачи' },
                    project: { type: 'string', description: 'Название проекта' },
                    deadline: { type: 'string', description: 'Дедлайн' }
                },
                required: ['title']
            }
        },
        {
            name: 'update_task_status',
            description: 'Меняет статус задачи.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Точное название задачи' },
                    status: { type: 'string', description: 'Статус: completed или pending' }
                },
                required: ['title', 'status']
            }
        },
        {
            name: 'add_project',
            description: 'Создает новый проект или обновляет существующий.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Название проекта' },
                    description: { type: 'string', description: 'Описание, цели проекта' }
                },
                required: ['name', 'description']
            }
        },
        {
            name: 'get_all_data',
            description: 'Получает список всех проектов и задач.',
            parameters: {
                type: 'object'
            }
        },
        {
            name: 'google_create_folder',
            description: 'Создает папку для проекта на Google Диске.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Название папки (обычно название проекта)' }
                },
                required: ['name']
            }
        },
        {
            name: 'google_create_reminder',
            description: 'Создает напоминание или событие в Google Календаре.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Заголовок напоминания' },
                    startTime: { type: 'string', description: 'Время начала в формате ISO (например, 2024-04-03T10:00:00Z)' }
                },
                required: ['title', 'startTime']
            }
        }
    ]
}];

async function processMessage(userId, message) {
    const history = await db.getHistory(userId);
    const contents = [...history, { role: 'user', parts: [{ text: message }] }];
    
    try {
        const ai = await getAI();
        console.log("[AI] Sending request to gemini-2.5-flash...");

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: {
                systemInstruction: PROMPT,
                tools: [{ functionDeclarations: tools }]
            }
        });

        // В новом унифицированном SDK результат вызова уже содержит кандидатов
        const candidate = result.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        
        let finalOutput = "";
        
        for (const part of parts) {
            if (part.functionCall) {
                const call = part.functionCall;
                const args = call.args;
                
                console.log(`[AI] Function Call: ${call.name}`, args);

                if (call.name === 'add_task') {
                    await db.addTask({
                        title: args.title,
                        project: args.project || 'Общее',
                        deadline: args.deadline || 'АСАП',
                        status: 'pending',
                        createdAt: new Date().toISOString()
                    });
                    finalOutput += `📌 Задача "${args.title}" записана в БД.\n`;
                } else if (call.name === 'add_project') {
                    await db.addProject({
                        name: args.name,
                        description: args.description,
                        updatedAt: new Date().toISOString()
                    });
                    finalOutput += `📁 Проект "${args.name}" создан в БД.\n`;
                } else if (call.name === 'get_all_data') {
                    const data = await db.getDb();
                    const projectsList = data.projects.map(p => `- ${p.name}: ${p.description}`).join('\n');
                    const tasksList = data.tasks.filter(t => t.status === 'pending').map(t => `- [${t.project}] ${t.title}`).join('\n');
                    finalOutput += `📊 Твой срез:\n\nПРОЕКТЫ:\n${projectsList || 'Нет'}\n\nЗАДАЧИ:\n${tasksList || 'Нет'}\n`;
                } else if (call.name === 'google_create_folder') {
                    const folder = await googleService.createProjectFolder(args.name);
                    finalOutput += `☁️ Папка проекта "${args.name}" создана на Google Диске (ID: ${folder.id}).\n`;
                } else if (call.name === 'google_create_reminder') {
                    const event = await googleService.addCalendarReminder(args.title, args.startTime);
                    finalOutput += `📅 Напоминание "${args.title}" добавлено в Google Календарь.\n`;
                }
            } else if (part.text) {
                finalOutput += part.text;
            }
        }

        if (!finalOutput) finalOutput = "Принято!";

        await db.addHistory(userId, 'user', message);
        await db.addHistory(userId, 'model', finalOutput);

        return finalOutput;
    } catch (e) {
        console.error("AI Error:", e.message);
        if (e.response && e.response.status) {
            console.error("AI HTTP Status:", e.response.status);
        }
        if (e.status === 404 || (e.response && e.response.status === 404) || e.message.includes('404')) {
            console.error("[AI] 404 Model Not Found. Listing available models...");
            try {
                const aiInstance = await getAI();
                const response = await aiInstance.models.list();
                const models = [];
                for await (const m of response) {
                    models.push(m.name);
                }
                console.error("[AI] Available models:", models.join(", "));
            } catch (listErr) {
                console.error("[AI] Failed to list models:", listErr.message);
            }
        }
        return `Ошибка связи с интеллектом. [${e.status || 'API_ERROR'}]`;
    }
}

module.exports = { processMessage };
