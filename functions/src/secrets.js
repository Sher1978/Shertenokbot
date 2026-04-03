let client = null;
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// In-memory cache — секреты не меняются во время жизни инстанса
const secretCache = new Map();

/**
 * Надежно получает секрет из Google Secret Manager или переменных окружения.
 * Кэширует результат чтобы не ходить в Secret Manager повторно.
 */
async function getSecret(secretName) {
    if (!client) {
        client = new SecretManagerServiceClient();
    }

    if (secretCache.has(secretName)) {
        return secretCache.get(secretName);
    }

    // 1. Пробуем стандартное окружение
    if (process.env[secretName]) {
        const val = process.env[secretName];
        secretCache.set(secretName, val);
        console.log(`[Secrets] ${secretName} from env (length: ${val.length})`);
        return val;
    }

    // 2. Пробуем прямое обращение к Secret Manager
    try {
        const projectId = process.env.GCLOUD_PROJECT || 'sarafun-f9616';
        console.log(`[Secrets] Fetching ${secretName} from Secret Manager...`);
        
        const [version] = await client.accessSecretVersion({
            name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
        });
        
        const value = version.payload.data.toString().trim();
        if (!value) throw new Error("Secret payload is empty");

        secretCache.set(secretName, value);
        return value;
    } catch (err) {
        console.error(`[Secrets] CRITICAL: Failed to get secret ${secretName}:`, err.message);
        throw new Error(`Secret ${secretName} is missing or inaccessible.`);
    }
}

/**
 * Robustly parses a JSON secret, with regex fallback for malformed JSON
 * (e.g. unescaped newlines in private key).
 */
function parseJsonSecret(secretContent) {
    if (!secretContent) return null;
    
    // Diagnostic: Log length to catch truncation/mis-copying
    console.log(`[Secrets] Received secret string of length: ${secretContent.length}`);
    
    try {
        return JSON.parse(secretContent);
    } catch (err) {
        console.warn(`[Secrets] JSON.parse failed (pos: ${err.message}). Attempting regex recovery...`);
        
        // Fallback: extract key fields using regex if JSON is malformed
        const emailMatch = secretContent.match(/"client_email"\s*:\s*"([^"]+)"/);
        const keyMatch = secretContent.match(/"private_key"\s*:\s*"([\s\S]+?)"/);
        
        if (emailMatch && keyMatch) {
            console.log(`[Secrets] Success via Regex Extraction: ${emailMatch[1]}`);
            return {
                client_email: emailMatch[1],
                private_key: keyMatch[1].replace(/\\n/g, '\n')
            };
        }
        
        throw new Error(`[Secrets] Failed to parse JSON secret and recovery failed: ${err.message}`);
    }
}

module.exports = { getSecret, parseJsonSecret };
