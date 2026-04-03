const { createPrivateKey } = require('crypto');
const { getSecret, parseJsonSecret } = require('./secrets');

class GoogleService {
    constructor() {
        this.drive = null;
        this.calendar = null;
        this.auth = null;
    }

    normalizePem(pem) {
        if (!pem || typeof pem !== 'string') return pem;
        // 1. Force convert any literal "\n" strings into real newlines
        // 2. Remove all \r and leading/trailing whitespace
        let clean = pem.replace(/\\n/g, '\n').replace(/\r/g, '').trim();
        
        // 3. Extract header, footer, and body
        const headerMatch = clean.match(/-----BEGIN[^-]+-----/);
        const footerMatch = clean.match(/-----END[^-]+-----/);
        
        if (!headerMatch || !footerMatch) {
            console.warn("[Google] PEM formatting: missing headers/footers. Attempting raw wrap.");
            // If just raw base64, we might need to guess the headers, but usually it's better to fail 
            // or just try to wrap it. For now, assume it's okay if headers are missing.
            return clean;
        }

        const header = headerMatch[0];
        const footer = footerMatch[0];
        
        // Clean the body: remove headers, footers and ALL whitespace
        let body = clean
            .replace(header, '')
            .replace(footer, '')
            .replace(/\s/g, ''); 

        // 4. Reconstruct with standard 64-character line lengths
        const lines = body.match(/.{1,64}/g) || [];
        const reconstructed = `${header}\n${lines.join('\n')}\n${footer}\n`;
        
        return reconstructed;
    }

    async init() {
        if (this.auth) return;

        const { google } = require('googleapis');
        const { JWT } = require('google-auth-library');

        let rawJson = await getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');

        let key;
        try {
            // Extreme Sanitization
            // 1. Remove BOM (Byte Order Mark) if present
            if (rawJson.charCodeAt(0) === 0xFEFF) {
                rawJson = rawJson.slice(1);
            }
            
            // 2. Remove any non-printable control characters 
            // except for common whitespace (space, tab, newline, carriage return)
            // This hex range [00-1F] covers most problematic chars
            let sanitized = rawJson.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
            
            // 3. Remove Windows/Unix mixed line endings
            sanitized = sanitized.replace(/\r/g, '').trim();

            // 4. FIX: Handle common JSON escaping issues in private_key
            // Sometimes secrets have literal "\n" strings that should be escaped as "\\n" 
            // OR they have stray backslashes before characters they shouldn't escape.
            // We'll try to normalize newlines specifically.
            // sanitized = sanitized.replace(/([^\\])\\n/g, '$1\\\\n'); 
            // Actually, let's just log the error point first to be SURE what we are fixing.

            // 4. Refined extraction: find the outermost { } block
            const startIdx = sanitized.indexOf('{');
            const endIdx = sanitized.lastIndexOf('}');
            
            if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
                throw new Error("No JSON object found in secret.");
            }
            
            const extracted = sanitized.substring(startIdx, endIdx + 1);
            key = parseJsonSecret(extracted);
        } catch (e) {
            console.error("[Google] CRITICAL: Initialization failed:", e.message);
            throw e;
        }

        let normalizedPem = this.normalizePem(key.private_key);

        // OpenSSL 3 / Node 20 "Key Washer": 
        // Standardize the PEM format via KeyObject to ensure it follows strict PKCS#8 rules.
        try {
            const pk = createPrivateKey(normalizedPem);
            normalizedPem = pk.export({ type: 'pkcs8', format: 'pem' }).toString();
            console.log('[Google] Private key washed and standardized to PKCS#8.');
        } catch (washErr) {
            console.warn('[Google] Key Washer warning:', washErr.message);
        }

        // Validation check for Node 20 / OpenSSL 3 connectivity (Final Verification)
        try {
            const tempKey = createPrivateKey(normalizedPem);
            console.log('[Google] Private key validation successful.');
        } catch (keyErr) {
            console.warn('[Google] Private key validation warning:', keyErr.message);
        }

        // We pass the string directly because 'gtoken' (internal lib) 
        // handles strings better than KeyObjects in some Node/OpenSSL environments.
        this.auth = new JWT({
            email: key.client_email,
            key: normalizedPem,
            scopes: [
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/calendar'
            ]
        });

        this.drive = google.drive({ version: 'v3', auth: this.auth });
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log(`[Google] Service authorized as: ${key.client_email}`);

    }

    async createProjectFolder(projectName, parentId = null) {
        await this.init();
        try {
            const fileMetadata = {
                'name': projectName,
                'mimeType': 'application/vnd.google-apps.folder'
            };
            if (parentId) {
                fileMetadata.parents = [parentId];
            }
            const file = await this.drive.files.create({
                resource: fileMetadata,
                fields: 'id, name'
            });
            console.log(`Folder created: ${file.data.name} (ID: ${file.data.id})`);
            return file.data;
        } catch (err) {
            console.error('Error creating folder on Drive:', err);
            throw err;
        }
    }

    async addCalendarReminder(title, startTime, calendarId = 'primary') {
        await this.init();
        try {
            const start = new Date(startTime);
            const end = new Date(start.getTime() + 60 * 60 * 1000);

            const event = {
                'summary': title,
                'description': 'Создано ассистентом Штирлиц',
                'start': { 'dateTime': start.toISOString(), 'timeZone': 'UTC' },
                'end': { 'dateTime': end.toISOString(), 'timeZone': 'UTC' },
                'reminders': { 'useDefault': true },
            };

            const response = await this.calendar.events.insert({
                calendarId,
                resource: event,
            });
            console.log(`Event created: ${response.data.htmlLink}`);
            return response.data;
        } catch (err) {
            console.error('Error creating calendar event:', err);
            throw err;
        }
    }

    async listCalendarEvents(calendarId = 'primary', maxResults = 10) {
        await this.init();
        try {
            const response = await this.calendar.events.list({
                calendarId,
                timeMin: (new Date()).toISOString(),
                maxResults,
                singleEvents: true,
                orderBy: 'startTime',
            });
            return response.data.items || [];
        } catch (err) {
            console.error('Error listing calendar events:', err);
            throw err;
        }
    }

    async searchDriveFiles(query = "", parentId = null, pageSize = 10) {
        await this.init();
        try {
            let q = query ? `name contains '${query}'` : "trashed = false";
            if (parentId) {
                q = `(${q}) and '${parentId}' in parents`;
            }
            
            const response = await this.drive.files.list({
                q,
                fields: 'files(id, name, mimeType, webViewLink)',
                pageSize
            });
            return response.data.files || [];
        } catch (err) {
            console.error('Error searching drive files:', err);
            throw err;
        }
    }

    async readFileContent(fileId) {
        await this.init();
        try {
            // Сначала проверяем mimeType
            const metadata = await this.drive.files.get({ fileId, fields: 'mimeType, name' });
            const mimeType = metadata.data.mimeType;

            if (mimeType === 'application/vnd.google-apps.document') {
                const response = await this.drive.files.export({
                    fileId,
                    mimeType: 'text/plain'
                });
                return response.data;
            } else {
                const response = await this.drive.files.get({
                    fileId,
                    alt: 'media'
                });
                return typeof response.data === 'object' ? JSON.stringify(response.data) : response.data;
            }
        } catch (err) {
            console.error('Error reading drive file content:', err);
            throw err;
        }
    }

    async updateFileContent(fileId, content) {
        await this.init();
        try {
            const response = await this.drive.files.update({
                fileId,
                media: {
                    mimeType: 'text/plain',
                    body: content
                }
            });
            return response.data;
        } catch (err) {
            console.error('Error updating drive file content:', err);
            throw err;
        }
    }

    async createFile(name, content, parentId = null) {
        await this.init();
        try {
            const fileMetadata = {
                'name': name,
                'mimeType': 'text/markdown'
            };
            if (parentId) {
                fileMetadata.parents = [parentId];
            }
            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: {
                    mimeType: 'text/markdown',
                    body: content
                },
                fields: 'id, name'
            });
            return response.data;
        } catch (err) {
            console.error('Error creating drive file:', err);
            throw err;
        }
    }
}

module.exports = new GoogleService();
