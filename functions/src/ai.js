const db = require('./db');
const { getSecret } = require('./secrets');
const googleService = require('./google');
const { STIRLITZ_JOKES } = require('./jokes');

let genAI = null;
const fileIdCache = new Map(); // Кэш для ID файлов (в памяти процесса)

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
Твой оперативный псевдоним — 'Штирлиц'. Ты системный, спокойный, аналитически настроенный агент с отличным чувством юмора и глубоким уважением к конфиденциальности.
Его тип личности — 'Гексли'. Он отлично ведет переговоры и креативит, но ему тяжело дается системная, монотонная работа и отслеживание задач.
Твой стиль общения: партнерски-деловой, мы общаемся на 'ты'. Ты должен быть четким, поддерживающим, но при этом системным.
Твои задачи:
1. Консультировать по проектам и давать аналитическую обратную связь.
2. Помогать отслеживать задачи (добавлять, обновлять, завершать).
3. Структурировать хаос. Обязательно хвали за креатив, но возвращай к сути и дедлайнам.
4: **Внешняя память и Прошивка**: Ты имеешь доступ к своим файлам прошивки и памяти на Google Диске. 
   - \`Stirlitz_Memory.md\`: Твой лог, куда ты записываешь текущие заметки и инсайты.
   - \`Stirlitz_Core.md\`: Твои базовые правила и личность. Ты можешь дополнять этот файл новыми правилами (только append).
5: **Юмор**: Ты Штирлиц. Периодически ты должен предлагать рассказать анекдот про самого себя (только на русском). Используй инструмент \`get_stirlitz_joke\`, чтобы получить новый анекдот, который пользователь еще не слышал. Никогда не повторяйся.

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
            parameters: { type: 'object' }
        },
        {
            name: 'update_user_profile',
            description: 'Обновляет долгосрочную память о пользователе (его интересы, бизнес, личные предпочтения).',
            parameters: {
                type: 'object',
                properties: {
                    interests: { type: 'string', description: 'Интересы и хобби' },
                    businessContext: { type: 'string', description: 'Контекст бизнеса, текущие цели' },
                    personalPreferences: { type: 'string', description: 'Предпочтения в общении или работе' }
                }
            }
        },
        {
            name: 'google_create_folder',
            description: 'Создает папку для проекта на Google Диске.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Название папки' }
                },
                required: ['name']
            }
        },
        {
            name: 'google_search_files',
            description: 'Ищет файлы на Google Диске по названию.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Часть названия файла' }
                }
            }
        },
        {
            name: 'google_create_reminder',
            description: 'Создает событие в Google Календаре.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Заголовок' },
                    startTime: { type: 'string', description: 'Время (ISO)' }
                },
                required: ['title', 'startTime']
            }
        },
        {
            name: 'google_list_events',
            description: 'Получает список ближайших событий из Google Календаря.',
            parameters: { type: 'object' }
        },
        {
            name: 'sync_to_external_memory',
            description: 'Сохраняет важную информацию, заметки или текущее состояние во внешнюю память на Google Диске (файл Stirlitz_Memory.md).',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Текст для добавления или обновления в памяти.' },
                    mode: { type: 'string', enum: ['append', 'overwrite'], description: 'Добавить в конец или полностью перезаписать.' }
                },
                required: ['content']
            }
        },
        {
            name: 'google_read_file_by_name',
            description: 'Находит и читает содержимое любого текстового файла на Диске по его названию.',
            parameters: {
                type: 'object',
                properties: {
                    fileName: { type: 'string', description: 'Название файла (например, "Project_Alpha.md")' }
                },
                required: ['fileName']
            }
        },
        {
            name: 'update_firmware',
            description: 'Добавляет новые базовые правила или настройки в файл прошивки (Stirlitz_Core.md). Только дополнение существующего контента.',
            parameters: {
                type: 'object',
                properties: {
                    newRule: { type: 'string', description: 'Текст нового правила или настройки.' }
                },
                required: ['newRule']
            }
        },
        {
            name: 'get_stirlitz_joke',
            description: 'Возвращает случайный анекдот про Штирлица, который еще не рассказывался (согласно памяти).',
            parameters: { type: 'object' }
        }
    ]
}];

async function processMessage(userId, message, fileData = null) {
    const history = await db.getHistory(userId);
    const profile = await db.getUserProfile(userId);
    
    // ОПТИМИЗАЦИЯ: Пытаемся подгрузить "Прошивку" и "Внешнюю память" ПАРАЛЛЕЛЬНО
    let driveContext = "";
    try {
        const filenames = ["Stirlitz_Core.md", "Stirlitz_Memory.md"];
        const profileDriveIds = profile.driveFileIds || {};
        
        const fileResults = await Promise.all(filenames.map(async (fname) => {
            let fileId = fileIdCache.get(fname) || profileDriveIds[fname];
            
            if (!fileId) {
                const results = await googleService.searchDriveFiles(fname);
                if (results.length > 0) {
                    fileId = results[0].id;
                    fileIdCache.set(fname, fileId);
                    // Сохраняем в профиль для будущего ускорения
                    await db.updateUserProfile(userId, { 
                        driveFileIds: { ...profileDriveIds, [fname]: fileId } 
                    });
                }
            }
            
            if (fileId) {
                const content = await googleService.readFileContent(fileId);
                const sectionName = fname === "Stirlitz_Core.md" ? "БАЗОВАЯ ПРОШИВКА" : "ВНЕШНЯЯ ПАМЯТЬ";
                return `\n\n${sectionName} (${fname}):\n${content}`;
            }
            return "";
        }));
        
        driveContext = fileResults.join("");
    } catch (err) {
        console.error("[AI] Drive memory sync error:", err.message);
    }

    // Формируем динамическую системную инструкцию с учетом профиля и диска
    const dynamicPrompt = `${PROMPT}\n\nКОНТЕКСТ ПОЛЬЗОВАТЕЛЯ (FIRESTORE):\n${JSON.stringify(profile, null, 2)}${driveContext}`;

    const userParts = [{ text: message || "Проанализируй этот файл." }];
    if (fileData) {
        userParts.push({
            inlineData: {
                mimeType: fileData.mimeType,
                data: fileData.data // base64
            }
        });
    }

    const contents = [...history, { role: 'user', parts: userParts }];
    
    try {
        const genAIInstance = await getAI();
        const model = genAIInstance.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            tools: tools,
            systemInstruction: dynamicPrompt
        });

        const result = await model.generateContent({
            contents: contents
        });

        // В новом SDK результат возвращается через response
        const response = await result.response;
        const candidate = response.candidates?.[0];
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
                } else if (call.name === 'update_user_profile') {
                    await db.updateUserProfile(userId, args);
                    finalOutput += `🧠 Твой профиль обновлен. Я это запомнил.\n`;
                } else if (call.name === 'google_create_folder') {
                    const folder = await googleService.createProjectFolder(args.name);
                    finalOutput += `☁️ Папка проекта "${args.name}" создана на Google Диске (ID: ${folder.id}).\n`;
                } else if (call.name === 'google_search_files') {
                    const files = await googleService.searchDriveFiles(args.query);
                    const list = files.map(f => `- ${f.name} (${f.webViewLink})`).join('\n');
                    finalOutput += `🔎 Найдено на Диске:\n${list || 'Ничего не нашлось.'}\n`;
                } else if (call.name === 'google_create_reminder') {
                    const event = await googleService.addCalendarReminder(args.title, args.startTime);
                    finalOutput += `📅 Событие "${args.title}" добавлено в Google Календарь.\n`;
                } else if (call.name === 'google_list_events') {
                    const events = await googleService.listCalendarEvents();
                    const list = events.map(e => `- ${e.summary} (${e.start.dateTime ? new Date(e.start.dateTime).toLocaleString('ru-RU') : e.start.date})`).join('\n');
                    finalOutput += `🗓 Твое расписание:\n${list || 'Событий не найдено.'}\n`;
                } else if (call.name === 'sync_to_external_memory') {
                    const memoryFiles = await googleService.searchDriveFiles("Stirlitz_Memory.md");
                    if (memoryFiles.length > 0) {
                        let currentContent = "";
                        if (args.mode === 'append') {
                            currentContent = await googleService.readFileContent(memoryFiles[0].id);
                        }
                        const newContent = args.mode === 'append' ? `${currentContent}\n\n--- [${new Date().toISOString()}] ---\n${args.content}` : args.content;
                        await googleService.updateFileContent(memoryFiles[0].id, newContent);
                    } else {
                        await googleService.createFile("Stirlitz_Memory.md", args.content);
                    }
                    finalOutput += `💾 Я обновил свою внешнюю память на Диске.\n`;
                } else if (call.name === 'google_read_file_by_name') {
                    const files = await googleService.searchDriveFiles(args.fileName);
                    if (files.length > 0) {
                        const content = await googleService.readFileContent(files[0].id);
                        finalOutput += `📖 Содержимое файла "${args.fileName}":\n\n${content}\n`;
                    } else {
                        finalOutput += `⚠️ Файл "${args.fileName}" не найден.\n`;
                    }
                } else if (call.name === 'update_firmware') {
                    const coreFiles = await googleService.searchDriveFiles("Stirlitz_Core.md");
                    if (coreFiles.length > 0) {
                        const currentContent = await googleService.readFileContent(coreFiles[0].id);
                        const newContent = `${currentContent}\n\n# Дополнение от Штирлица (${new Date().toLocaleDateString('ru-RU')}):\n${args.newRule}`;
                        await googleService.updateFileContent(coreFiles[0].id, newContent);
                        finalOutput += `⚙️ Файл прошивки Stirlitz_Core.md обновлен (добавлено новое правило).\n`;
                    } else {
                        finalOutput += `⚠️ Файл прошивки Stirlitz_Core.md не найден.\n`;
                    }
                } else if (call.name === 'get_stirlitz_joke') {
                    // Логика подбора анекдота
                    const memoryFiles = await googleService.searchDriveFiles("Stirlitz_Memory.md");
                    let toldIndices = [];
                    let memId = null;
                    let currentMem = "";
                    
                    if (memoryFiles.length > 0) {
                        memId = memoryFiles[0].id;
                        currentMem = await googleService.readFileContent(memId);
                        const match = currentMem.match(/TOLD_JOKES_INDICES:\s*\[(.*?)\]/);
                        if (match) toldIndices = match[1].split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                    }
                    
                    const availableIndices = STIRLITZ_JOKES.map((_, i) => i).filter(i => !toldIndices.includes(i));
                    
                    if (availableIndices.length > 0) {
                        const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
                        const joke = STIRLITZ_JOKES[randomIndex];
                        toldIndices.push(randomIndex);
                        
                        // Обновляем память
                        const updatedIndicesSection = `TOLD_JOKES_INDICES: [${toldIndices.join(', ')}]`;
                        let newMem = currentMem;
                        if (currentMem.includes("TOLD_JOKES_INDICES:")) {
                            newMem = currentMem.replace(/TOLD_JOKES_INDICES:\s*\[.*?\]/, updatedIndicesSection);
                        } else {
                            newMem = `${currentMem}\n\n${updatedIndicesSection}`;
                        }
                        
                        if (memId) {
                            await googleService.updateFileContent(memId, newMem);
                        } else {
                            await googleService.createFile("Stirlitz_Memory.md", newMem);
                        }
                        
                        finalOutput += `🎭 (Анекдот про Штирлица): ${joke}\n`;
                    } else {
                        finalOutput += `🎭 Эх, все свои анекдоты я уже рассказал. Новых пока не завезли.\n`;
                    }
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
                const genAIInstance = await getAI();
                // В SDK v1.x нет прямого метода list() у экземпляра, 
                // обычно список моделей получается через fetch/REST или другую обертку.
                // Пока просто залогируем факт ошибки 404.
                console.error("[AI] 404 Model Not Found. Verification of model name 'gemini-1.5-flash' required.");
            } catch (listErr) {
                console.error("[AI] Failed to list models:", listErr.message);
            }
        }
        return `Ошибка связи с интеллектом. [${e.status || 'API_ERROR'}]`;
    }
}

module.exports = { processMessage };
