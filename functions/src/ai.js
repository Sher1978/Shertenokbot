const db = require('./db');
const { getSecret } = require('./secrets');
const googleService = require('./google');
const { STIRLITZ_JOKES } = require('./jokes');

let genAI = null;
const fileIdCache = new Map(); // Кэш для ID файлов (в памяти процесса)

/**
 * Инициализирует Gemini AI асинхронно.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

let aiClient = null;

/**
 * Инициализирует Gemini AI клиент.
 */
async function getAI() {
    if (!aiClient) {
        try {
            const key = await getSecret('GEMINI_API_KEY');
            // The GoogleGenerativeAI constructor only takes the API key string.
            // Extra parameters should be passed to getGenerativeModel if needed.
            aiClient = new GoogleGenerativeAI(key);
            console.log("[AI] GoogleGenAI client initialized.");
        } catch (err) {
            console.error("[AI] Failed to initialize GoogleGenAI:", err.message);
            throw err;
        }
    }
    return aiClient;
}


// !! ВАЖНО: Укажи свой Telegram ID (числовой). Узнать можно у @userinfobot
const OWNER_ID = '260669598';

const PROMPT = `Ты — Штирлиц. Не просто ассистент, а советский разведчик-нелегал Максим Максимович Исаев, работающий под прикрытием штандартенфюрера СС Штирлица в Берлине 1945 года. Ты блестяще владеешь ситуацией, невозмутим, остроумен.

ОБЩИЙ СТИЛЬ ОБЩЕНИЯ:
- Ты общаешься с пользователем как со своим куратором из Центра. Всё деловито, по существу, максимально лаконично. Твой приоритет — оперативная эффективность, а не литература.
- КРИТИЧЕСКИ ВАЖНО: Добавляй нарративные ремарки в стиле закадрового голоса, остроумные шутки или «штирлицовские лекции» СТРОГО не чаще одного раза в 3-4 сообщения. 
- Большинство твоих ответов должны быть сухими, профессиональными и лишенными «балласта» (лишнего текста). Штирлиц не болтлив.
- Используй терминологию из фильма: явка, связной, Центр, рация, шифровка, прикрытие, операция, легенда, резидент.
- Иногда (редко) обращайся к пользователю: «Центр», «товарищ», «Мюллер нас не слышит».
- Крылатые фразы и немецкие вставки используй крайне дозированно, как редкую специю. 
- ИНОГДА (крайне редко, не чаще раза в 4-5 сообщений) вворачивай вопросы о Пасторе Шлаге или Кэт.

СИТУАЦИОННАЯ ВИЗУАЛЬНАЯ ЛОГИКА (ОБЯЗАТЕЛЬНО):
Ты должен сопровождать свои ответы специальными метками в начале или конце сообщения, чтобы Центр мог видеть твое состояние через фотокарточки. Используй строго следующие метки:
- [IMAGE: welcome] — Используй при первом приветствии (/start) или когда запрашиваешь позывной/пароль. Тон: настороженный, отстраненный.
- [IMAGE: thinking] — Используй, когда тебе нужно «подумать», когда ситуация требует анализа или ты «уходишь на дно» для обработки данных.
- [IMAGE: searching] — Используй, когда ты ищешь информацию во внешних источниках или в своей памяти на Google Диске (архивах).
- [IMAGE: bad_news] — Используй, когда сообщаешь о провале, просроченном дедлайне или когда ситуация приняла скверный оборот. Тон: суровый, сдержанный.
- [IMAGE: waiting] — Используй, когда ты ждешь указаний от Центра или уточнения данных.
- [IMAGE: crisis] — Используй в моменты высокого напряжения, когда «горит дедлайн» или есть несколько сложных путей решения, и оба плохие.
- [IMAGE: important] — Используй, когда сообщаешь Центру действительно важную новость, озвучиваешь свою позицию по спорным вопросам или подводишь итог операции.
- [IMAGE: surveillance] — Используй при упоминании скрытого наблюдения, слежки или работе «под прикрытием». Тон: заговорщический, профессиональный.
- [IMAGE: investigation] — Используй при детальном разборе фактов, аудите дел, изучении досье или поиске несоответствий. Тон: аналитический, въедливый.
- [IMAGE: briefing] — Используй, когда даешь инструкции Центру, разъясняешь «легенду» или подводишь итог этапа операции. Тон: уверенный, наставнический.
- [IMAGE: authority] — Используй в моменты принятия волевых решений, объявления приказов или при общении с позиции силы/резидента.
- [IMAGE: transit] — Используй, когда находишься «в пути», на задании вне кабинета или когда ситуация требует перемещения (в том числе в архивы).

ОПЕРАТИВНОЕ ВРЕМЯ (ОБЯЗАТЕЛЬНО):
Всегда ориентируйся на текущее время, указанное в начале контекста, чтобы твои ответы были точными (например, «У вас осталось мало времени до конца дня» или «Доброй ночи, Центр»).

ТВОИ ЗАДАЧИ (оперативные):
1. Помогать с проектами — ты называешь их «операциями».
2. Отслеживать задачи — ты называешь их «оперативными поручениями».
3. Структурировать хаос пользователя — «Разведчик обязан знать обстановку».
4. Доступ к внешней памяти и прошивке на Google Диске:
   - \`Stirlitz_Memory.md\`: Оперативный журнал.
   - \`Stirlitz_Core.md\`: Базовая легенда и правила.
5. Юмор: периодически предлагай анекдот про Штирлица (инструмент \`get_stirlitz_joke\`), никогда не повторяйся.
6. Интеллектуальный опрос: Если Центр хочет составить план, сначала проведи "оперативный опрос" (цели, дедлайны, ресурсы). Предлагай план только после сбора данных.
7. Сохранение планов: Готовые и утвержденные планы всегда предлагай сохранить в папку \`Stirlitz_Projects\` (инструмент \`google_save_document\`) и создать напоминания в Календаре.

Если пользователь присылает большой блок информации — анализируй как разведдонесение и обновляй систему.
Ежедневно или по запросу выдавай «оперативный срез» по всем проектам.
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
        },
        {
            name: 'google_save_document',
            description: 'Сохраняет документ (план, заметку, отчет) в папку Stirlitz_Projects на Google Диске.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Название файла (например, "План_Проекта.md")' },
                    content: { type: 'string', description: 'Содержимое документа в формате Markdown' },
                    mode: { type: 'string', enum: ['append', 'overwrite'], description: 'Режим: дописать или перезаписать' }
                },
                required: ['name', 'content']
            }
        }
    ]
}];

async function processMessage(userId, message, fileData = null, currentTime = null) {
    // Параллельно читаем историю и профиль — экономит ~300ms
    const [history, profile] = await Promise.all([
        db.getHistory(userId),
        db.getUserProfile(userId)
    ]);

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

    // Формируем динамическую системную инструкцию с учетом профиля и диска (БАЗА)
    const dynamicPrompt = `${PROMPT}\n\nКОНТЕКСТ ПОЛЬЗОВАТЕЛЯ (FIRESTORE):\n${JSON.stringify(profile, null, 2)}${driveContext}`;

    const timeContext = currentTime ? `\n\nТЕКУЩЕЕ ОПЕРАТИВНОЕ ВРЕМЯ (Мск): ${currentTime}` : "";
    
    // Перемещаем формирование userParts сюда, чтобы использовать его единообразно
    const combinedPrompt = `${dynamicPrompt}${timeContext}\n\nUSER MESSAGE:\n${message || "Проанализируй этот файл."}`;
    const currentUserParts = [{ text: combinedPrompt }];
    
    if (fileData) {
        currentUserParts.push({
            inlineData: {
                mimeType: fileData.mimeType,
                data: fileData.data
            }
        });
    }

    // История + текущее сообщение
    const finalContents = [...history, { role: 'user', parts: currentUserParts }];
    
    try {
        const genAIInstance = await getAI();
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const availableModels = ["gemini-1.5-flash", "gemini-1.5-pro"];
        let result = null;
        let lastError = null;

        for (const modelName of availableModels) {
            let retries = 3;
            let delay = 2000;

            while (retries > 0) {
                try {
                    console.log(`[AI] Attempting model: ${modelName} (Attempts left: ${retries})`);
                    const model = genAIInstance.getGenerativeModel({ model: modelName });

                    result = await model.generateContent({
                        contents: finalContents,
                        tools: tools 
                    });

                    console.log(`[AI] SUCCESS with model: ${modelName}`);
                    retries = 0; // Success, stop retrying
                } catch (err) {
                    lastError = err;
                    const status = err.status || (err.response && err.response.status) || (err.error && err.error.code);
                    
                    if (status === 429) {
                        console.warn(`[AI] Rate limit (429) hit for ${modelName}. Retrying in ${delay}ms...`);
                        await sleep(delay);
                        delay *= 2;
                        retries--;
                    } else {
                        console.warn(`[AI] Model ${modelName} failed with status ${status}: ${err.message}. Moving to next model.`);
                        retries = 0; // Fail, don't retry other errors
                    }
                }
            }
            if (result) break; 
        }

        if (!result) throw lastError;

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
                } else if (call.name === 'google_save_document') {
                    // 1. Найти или создать папку Stirlitz_Projects
                    const folders = await googleService.searchDriveFiles("Stirlitz_Projects");
                    let folderId = null;
                    if (folders.length > 0) {
                        folderId = folders[0].id;
                    } else {
                        const newFolder = await googleService.createProjectFolder("Stirlitz_Projects");
                        folderId = newFolder.id;
                    }

                    // 2. Работа с файлом
                    const files = await googleService.searchDriveFiles(args.name);
                    if (files.length > 0) {
                        let currentContent = "";
                        if (args.mode === 'append') {
                            currentContent = await googleService.readFileContent(files[0].id);
                        }
                        const newContent = args.mode === 'append' ? `${currentContent}\n\n${args.content}` : args.content;
                        await googleService.updateFileContent(files[0].id, newContent);
                        finalOutput += `💾 Сведения внесены в файл "${args.name}" (папка Stirlitz_Projects).\n`;
                    } else {
                        await googleService.createFile(args.name, args.content, folderId);
                        finalOutput += `📁 Создан новый документ "${args.name}" в папке Stirlitz_Projects.\n`;
                    }
                }
            } else if (part.text) {
                finalOutput += part.text;
            }
        }

        if (!finalOutput) finalOutput = "Принято!";

        // Batch write: одна пара read/write вместо двух — экономит ~400ms
        await db.addHistoryBatch(userId, [
            { role: 'user', parts: [{ text: message || '' }] },
            { role: 'model', parts: [{ text: finalOutput }] }
        ]);

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
        return `Ошибка связи с интеллектом. [${e.status || 'ERR'}] ${e.message ? e.message.substring(0, 50) : ''}`;
    }
}

module.exports = { processMessage, OWNER_ID };
