const { createPrivateKey } = require('crypto');
const { getSecret, parseJsonSecret } = require('./secrets');

class GoogleService {
    constructor() {
        this.drive = null;
        this.calendar = null;
        this.auth = null;
    }

    _standardizeKey(rawKey) {
        if (!rawKey || typeof rawKey !== 'string') {
            console.error("[PEM Doctor] Key is missing or not a string.");
            return rawKey;
        }

        // 1. Extract ONLY the Base64 body
        // We strip headers, footers, escaped newlines, and ALL whitespace.
        const body = rawKey
            .replace(/-----BEGIN[^-]+-----/g, '')
            .replace(/-----END[^-]+-----/g, '')
            .replace(/\\n/g, '')
            .replace(/\s+/g, ''); 

        if (body.length < 500) {
            console.error(`[PEM Doctor] CRITICAL: Key body too short (${body.length} chars).`);
            return rawKey;
        }

        // 2. Reconstruct standard PKCS#8 PEM
        // OpenSSL 3 / Node 20 is extremely sensitive to line lengths and headers.
        const lines = body.match(/.{1,64}/g) || [];
        const reconstructed = [
            '-----BEGIN PRIVATE KEY-----',
            ...lines,
            '-----END PRIVATE KEY-----',
            '' // Trailing newline
        ].join('\n');

        console.log(`[PEM Doctor] Reconstructed key (Body: ${body.length}, Total: ${reconstructed.length}).`);

        // 3. Final validation check
        try {
            createPrivateKey(reconstructed);
            console.log("[PEM Doctor] Key validation: SUCCESS.");
        } catch (err) {
            console.error("[PEM Doctor] Key validation: FAILED.", err.message);
            // We return it anyway and hope for the best, or log diagnostic clues.
        }

        return reconstructed;
    }

    async init() {
        if (this.auth) return;

        const { google } = require('googleapis');
        const { JWT } = require('google-auth-library');

        const rawJsonSecret = await getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');
        const serviceAccount = parseJsonSecret(rawJsonSecret);

        if (!serviceAccount || !serviceAccount.private_key) {
            throw new Error("[Google] Failed to extract private_key from secret.");
        }

        const normalizedPem = this._standardizeKey(serviceAccount.private_key);

        this.auth = new JWT({
            email: serviceAccount.client_email,
            key: normalizedPem,
            scopes: [
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/calendar'
            ]
        });

        this.drive = google.drive({ version: 'v3', auth: this.auth });
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log(`[Google] Service authorized as: ${serviceAccount.client_email}`);
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
            console.log(`[Google] Creating reminder: "${title}" at ${startTime} in calendar ${calendarId}`);
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
                }, { responseType: 'text' });
                // If the response is an object, try to format it, but prefer raw string.
                if (typeof response.data === 'object') {
                     // If it's a buffer or JSON, try to stringify. But with responseType: 'text', it should be string.
                     return typeof response.data.toString === 'function' ? response.data.toString() : JSON.stringify(response.data);
                }
                return response.data;
            }
        } catch (err) {
            console.error('Error reading drive file content:', err);
            throw err;
        }
    }

    async updateFileContent(fileId, content) {
        await this.init();
        try {
            console.log(`[Google] Updating file ${fileId} with ${content?.length || 0} characters.`);
            const response = await this.drive.files.update({
                fileId,
                media: {
                    mimeType: 'text/markdown',
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
            console.log(`[Google] Creating file "${name}" in parent ${parentId} (${content?.length || 0} chars).`);
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
