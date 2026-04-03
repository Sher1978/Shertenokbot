const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db');
const { getSecret } = require('./secrets');

let genAI = null;

/**
 * Инициализирует Gemini AI асинхронно.
 */
async function getAI() {
    if (!genAI) {
        const key = await getSecret('GEMINI_API_KEY');
        genAI = new GoogleGenerativeAI(key);
    }
    return genAI;
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
        const aiInstance = await getAI();
        const apiKey = await getSecret('GEMINI_API_KEY');
        console.log(`[AI] Initializing model with key prefix: ${apiKey.substring(0, 5)}...`);
        
        const model = aiInstance.getGenerativeModel({ model: "gemini-1.5-flash" });
        const googleService = require('./google');

        console.log("[AI] Sending request to Gemini 1.5 Flash...");

        const result = await model.generateContent({
            contents,
            tools,
            systemInstruction: PROMPT
        });

        const response = result.response;
        const functionCalls = response.functionCalls();
        let finalOutput = "";

        if (functionCalls && functionCalls.length > 0) {
            for (const call of functionCalls) {
                const args = call.args;
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
            }
        }

        const text = response.text();
        if (text) finalOutput += text;
        if (!finalOutput) finalOutput = "Принято!";

        await db.addHistory(userId, 'user', message);
        await db.addHistory(userId, 'model', finalOutput);

        return finalOutput;
    } catch (e) {
        console.error("AI Error:", e);
        return "Ошибка связи с интеллектом.";
    }
}

module.exports = { processMessage };
