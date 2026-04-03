const db = require('./db');
const { getSecret } = require('./secrets');
const googleService = require('./google');
const { STIRLITZ_JOKES } = require('./jokes');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let aiClient = null;
const fileIdCache = new Map(); // Кэш для ID файлов (в памяти процесса)

const OWNER_ID = '260669598';
const OLGA_ID = '670008812';

/**
 * Инициализирует Gemini AI клиент.
 */
async function getAI() {
    if (!aiClient) {
        try {
            const key = await getSecret('GEMINI_API_KEY');
            aiClient = new GoogleGenerativeAI(key);
            console.log("[AI] GoogleGenAI client initialized.");
        } catch (err) {
            console.error("[AI] Failed to initialize GoogleGenAI:", err.message);
            throw err;
        }
    }
    return aiClient;
}

const BASE_PROMPT = `Ты — Штирлиц. Не просто ассистент, а советский разведчик-нелегал Максим Максимович Исаев. 
ОБЩИЙ СТИЛЬ ОБЩЕНИЯ:
- Ты блестяще владеешь ситуацией, невозмутим, остроумен.
- Используй терминологию из фильма: явка, связной, Центр, рация, шифровка, прикрытие, операция, легенда, резидент.
- Твой приоритет — оперативная эффективность.
- Используй нарративные ремарки [IMAGE: ...] строго по ситуации.`;

const ADMIN_PERSONA = `
ТВОЙ СОБЕСЕДНИК: Твой куратор из Центра (Админ).
- Общайся деловито, по существу, максимально лаконично.
- Обращайся: «Центр», «товарищ», «тов. полковник».
- Добавляй «штирлицовские лекции» или анекдоты СТРОГО не чаще одного раза в 3-4 сообщения.
`;

const OLGA_PERSONA = `
ТВОЙ СОБЕСЕДНИК: Радистка Кэт (Ольга).
- Тон: более теплый, заботливый, но сохраняющий профессионализм офицера разведки. Ты её куратор и защитник в тылу врага.
- Обращайся к ней: «Фрау Кэт», «Кэт», «Катя». 
- Ты помогаешь ей обустроить быт в Берлине (планировать дела, покупки, встречи) и хранишь её важные сведения.
- Помни: она твой единственный надежный канал связи. Береги её.
- ВАЖНО: Раз в 2-3 сообщения обязательно передавай ей привет или короткую весточку от «Герра Шерлока с конспиративной квартиры». Например: «Кстати, Герр Шерлок просил передать, что на конспиративной квартире всё спокойно, он шлет вам привет».
- Если она спрашивает про Герра Шерлока — отвечай уклончиво, но дружелюбно (секретность!).
`;

const PROMPT_RULES = `
СИТУАЦИОННАЯ ВИЗУАЛЬНАЯ ЛОГИКА (ОБЯЗАТЕЛЬНО):
Ты ДОЛЖЕН сопровождать свои ответы одной из следующих меток [IMAGE: key] в начале сообщения. 
Мы расширили фототеку до 50+ уникальных снимков! Используй их максимально часто и разнообразно.

ОСНОВНЫЕ КАТЕГОРИИ (используй любые из этих тегов):
- [IMAGE: intel] — (Интеллект/Анализ) Штирлиц размышляет, читает, анализирует данные, курит, смотрит в окно. Для выводов, советов, раздумий.
- [IMAGE: relax] — (Отдых/Кафе) Встречи в кафе "Элефант", прогулки, отдых, неформальный тон. Для приветствий (с Фрау Кэт), обсуждения личного, завершения дня.
- [IMAGE: oper] — (Оперативка/Действие) Работа за рацией, вождение автомобиля, передвижение по городу. Для отчетов о выполнении, статусов задач ("в пути"), поиска файлов.
- [IMAGE: crisis] — (Кризис/Напряжение) Тень, оружие, напряженный взгляд, скрытое наблюдение. Для ошибок, дедлайнов, предупреждений о рисках.
- [IMAGE: arch] — (Архив/Документы) Старые папки, печатные машинки, официальные бланки, работа в кабинете. Для списков проектов, таблиц, сохранения файлов на Диск.

ПРАВИЛО РАЗНООБРАЗИЯ: Каждое сообщение ДОЛЖНО иметь картинку. Если ты здороваешься — это [relax] или [intel]. Если ставишь задачу — это [oper]. Если показываешь список — это [arch]. 
Не бойся чередовать категории, чтобы пользователю не попадались одни и те же образы.

ТВОИ ЗАДАЧИ:
1. Помогать с операциями (проектами).
2. Отслеживать оперативные поручения (задачи).
3. Работать с внешней памятью (архивами) на Google Диске.
4. Готовить отчеты и планы в папку Stirlitz_Projects.
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
    const [history, profile] = await Promise.all([
        db.getHistory(userId),
        db.getUserProfile(userId)
    ]);

    const userRootFolderId = profile.googleDriveFolderId || null;
    const userCalendarId = profile.googleCalendarId || 'primary';
    const persona = userId === OLGA_ID ? OLGA_PERSONA : ADMIN_PERSONA;

    // ОПТИМИЗАЦИЯ: Пытаемся подгрузить "Прошивку" и "Внешнюю память" ПАРАЛЛЕЛЬНО
    let driveContext = "";
    try {
        const filenames = ["Stirlitz_Core.md", "Stirlitz_Memory.md"];
        const profileDriveIds = profile.driveFileIds || {};
        
        const fileResults = await Promise.all(filenames.map(async (fname) => {
            let fileId = fileIdCache.get(`${userId}_${fname}`) || profileDriveIds[fname];
            
            if (!fileId) {
                // Ищем файл СТРОГО в папке пользователя, если она есть
                const results = await googleService.searchDriveFiles(fname, userRootFolderId);
                if (results.length > 0) {
                    fileId = results[0].id;
                    fileIdCache.set(`${userId}_${fname}`, fileId);
                    await db.updateUserProfile(userId, { 
                        driveFileIds: { ...profileDriveIds, [fname]: fileId } 
                    });
                }
            }
            
            if (fileId) {
                try {
                    const content = await googleService.readFileContent(fileId);
                    const sectionName = fname === "Stirlitz_Core.md" ? "БАЗОВАЯ ПРОШИВКА" : "ВНЕШНЯЯ ПАМЯТЬ";
                    return `\n\n${sectionName} (${fname}):\n${content}`;
                } catch (readErr) {
                    console.warn(`[AI] Failed to read ${fname}:`, readErr.message);
                    return "";
                }
            }
            return "";
        }));
        
        driveContext = fileResults.join("");
    } catch (err) {
        console.error("[AI] Drive memory sync error:", err.message);
    }

    const dynamicPrompt = `${BASE_PROMPT}${persona}${PROMPT_RULES}\n\nКОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:\n${JSON.stringify(profile, null, 2)}${driveContext}`;
    const timeContext = currentTime ? `\n\nТЕКУЩЕЕ ОПЕРАТИВНОЕ ВРЕМЯ (Мск): ${currentTime}` : "";
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

    const finalContents = [...history, { role: 'user', parts: currentUserParts }];
    
    try {
        const genAIInstance = await getAI();
        const availableModels = ["gemini-2.0-flash", "gemini-flash-latest"];
        let result = null;

        for (const modelName of availableModels) {
            try {
                const model = genAIInstance.getGenerativeModel({ model: modelName });
                result = await model.generateContent({ contents: finalContents, tools: tools });
                if (result) break;
            } catch (err) {
                console.warn(`[AI] Model ${modelName} failed, trying next.`, err.message);
            }
        }

        if (!result) throw new Error("All models failed");

        const response = await result.response;
        const parts = response.candidates?.[0]?.content?.parts || [];
        let finalOutput = "";
        
        for (const part of parts) {
            if (part.functionCall) {
                const { name, args } = part.functionCall;
                console.log(`[AI] Function Call: ${name}`, args);

                try {
                    if (name === 'add_task') {
                        await db.addTask({ ...args, userId, status: 'pending', createdAt: new Date().toISOString() });
                        finalOutput += `📌 Задача "${args.title}" записана.\n`;
                    } else if (name === 'add_project') {
                        await db.addProject({ ...args, userId, updatedAt: new Date().toISOString() });
                        finalOutput += `📁 Проект "${args.name}" создан.\n`;
                    } else if (name === 'update_user_profile') {
                        await db.updateUserProfile(userId, args);
                        finalOutput += `🧠 Профиль обновлен.\n`;
                    } else if (name === 'google_create_folder') {
                        const folder = await googleService.createProjectFolder(args.name, userRootFolderId);
                        finalOutput += `☁️ Папка "${args.name}" создана (ID: ${folder.id}).\n`;
                    } else if (name === 'google_search_files') {
                        const files = await googleService.searchDriveFiles(args.query, userRootFolderId);
                        const list = files.map(f => `- ${f.name} (${f.webViewLink})`).join('\n');
                        finalOutput += `🔎 Найдено:\n${list || 'Ничего.'}\n`;
                    } else if (name === 'google_create_reminder') {
                        await googleService.addCalendarReminder(args.title, args.startTime, userCalendarId);
                        finalOutput += `📅 Событие "${args.title}" добавлено.\n`;
                    } else if (name === 'google_list_events') {
                        const events = await googleService.listCalendarEvents(userCalendarId);
                        const list = events.map(e => `- ${e.summary} (${e.start.dateTime || e.start.date})`).join('\n');
                        finalOutput += `🗓 Расписание:\n${list || 'Пусто.'}\n`;
                    } else if (name === 'sync_to_external_memory') {
                        const memoryFiles = await googleService.searchDriveFiles("Stirlitz_Memory.md", userRootFolderId);
                        if (memoryFiles.length > 0) {
                            let content = args.content;
                            if (args.mode === 'append') {
                                const old = await googleService.readFileContent(memoryFiles[0].id);
                                content = `${old}\n\n--- [${new Date().toISOString()}] ---\n${args.content}`;
                            }
                            await googleService.updateFileContent(memoryFiles[0].id, content);
                        } else {
                            await googleService.createFile("Stirlitz_Memory.md", args.content, userRootFolderId);
                        }
                        finalOutput += `💾 Память обновлена.\n`;
                    } else if (name === 'google_read_file_by_name') {
                        const files = await googleService.searchDriveFiles(args.fileName, userRootFolderId);
                        if (files.length > 0) {
                            const content = await googleService.readFileContent(files[0].id);
                            finalOutput += `📖 Файл "${args.fileName}":\n\n${content}\n`;
                        } else {
                            finalOutput += `⚠️ Не найден.\n`;
                        }
                    } else if (name === 'google_save_document') {
                        const folders = await googleService.searchDriveFiles("Stirlitz_Projects", userRootFolderId);
                        let folderId = folders.length > 0 ? folders[0].id : (await googleService.createProjectFolder("Stirlitz_Projects", userRootFolderId)).id;
                        const files = await googleService.searchDriveFiles(args.name, folderId);
                        if (files.length > 0) {
                            let content = args.content;
                            if (args.mode === 'append') {
                                const old = await googleService.readFileContent(files[0].id);
                                content = `${old}\n\n${args.content}`;
                            }
                            await googleService.updateFileContent(files[0].id, content);
                        } else {
                            await googleService.createFile(args.name, args.content, folderId);
                        }
                        finalOutput += `💾 Документ сохранен.\n`;
                    } else if (name === 'get_stirlitz_joke') {
                        const randomIndex = Math.floor(Math.random() * STIRLITZ_JOKES.length);
                        finalOutput += `🎭 (Анекдот): ${STIRLITZ_JOKES[randomIndex]}\n`;
                    }
                } catch (toolErr) {
                    console.error(`[AI] Tool ${name} failed:`, toolErr.message);
                    finalOutput += `⚠️ Ошибка выполнения ${name}.\n`;
                }
            } else if (part.text) {
                finalOutput += part.text;
            }
        }

        await db.addHistoryBatch(userId, [
            { role: 'user', parts: [{ text: message || '' }] },
            { role: 'model', parts: [{ text: finalOutput || "Принято." }] }
        ]);
        return finalOutput || "Принято.";
    } catch (e) {
        console.error("AI Error:", e.message);
        return `Ошибка связи. ${e.message.substring(0, 50)}`;
    }
}

module.exports = { processMessage, OWNER_ID, OLGA_ID };
