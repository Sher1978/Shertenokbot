const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

/**
 * Надежно получает секрет из Google Secret Manager или переменных окружения.
 * @param {string} secretName Имя секрета (напр. 'TELEGRAM_BOT_TOKEN')
 * @returns {Promise<string>} Значение секрета
 */
async function getSecret(secretName) {
    // 1. Пробуем стандартное окружение
    if (process.env[secretName]) {
        console.log(`[Secrets] Found ${secretName} in environment.`);
        return process.env[secretName];
    }

    // 2. Пробуем прямое обращение к Secret Manager
    try {
        const projectId = process.env.GCLOUD_PROJECT || 'sarafun-f9616';
        console.log(`[Secrets] Fetching ${secretName} from Secret Manager (project: ${projectId})...`);
        
        const [version] = await client.accessSecretVersion({
            name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
        });
        
        const value = version.payload.data.toString().trim();
        if (!value) throw new Error("Secret payload is empty");
        
        return value;
    } catch (err) {
        console.error(`[Secrets] CRITICAL: Failed to get secret ${secretName}:`, err.message);
        throw new Error(`Secret ${secretName} is missing or inaccessible.`);
    }
}

module.exports = { getSecret };
