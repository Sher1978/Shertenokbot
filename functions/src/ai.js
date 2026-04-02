const { GoogleGenAI, Type } = require('@google/genai');
const db = require('./db');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenAI(apiKey) : null;


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
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING, description: 'Название задачи' },
                    project: { type: Type.STRING, description: 'Название проекта' },
                    deadline: { type: Type.STRING, description: 'Дедлайн' }
                },
                required: ['title']
            }
        },
        {
            name: 'update_task_status',
            description: 'Меняет статус задачи.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING, description: 'Точное название задачи' },
                    status: { type: Type.STRING, description: 'Статус: completed или pending' }
                },
                required: ['title', 'status']
            }
        },
        {
            name: 'add_project',
            description: 'Создает новый проект или обновляет существующий.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: 'Название проекта' },
                    description: { type: Type.STRING, description: 'Описание, цели проекта' }
                },
                required: ['name', 'description']
            }
        },
        {
            name: 'get_all_data',
            description: 'Получает список всех проектов и задач.',
            parameters: {
                type: Type.OBJECT
            }
        }
    ]
}];

async function processMessage(userId, message) {
    const history = await db.getHistory(userId);
    const contents = [...history, { role: 'user', parts: [{ text: message }] }];
    
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        
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
                    finalOutput += `📌 Задача "${args.title}" записана.\n`;
                } else if (call.name === 'add_project') {
                    await db.addProject({
                        name: args.name,
                        description: args.description,
                        updatedAt: new Date().toISOString()
                    });
                    finalOutput += `📁 Проект "${args.name}" обновлен/создан.\n`;
                } else if (call.name === 'get_all_data') {
                    const data = await db.getDb();
                    const projectsList = data.projects.map(p => `- ${p.name}: ${p.description}`).join('\n');
                    const tasksList = data.tasks.filter(t => t.status === 'pending').map(t => `- [${t.project}] ${t.title}`).join('\n');
                    finalOutput += `📊 Твой срез:\n\nПРОЕКТЫ:\n${projectsList || 'Нет'}\n\nЗАДАЧИ:\n${tasksList || 'Нет'}\n`;
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
