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

        console.log(`[PEM Doctor] Standardizing key of length: ${rawKey.length}`);

        // 1. Normalize line endings and literal escape characters
        let key = rawKey.replace(/\\n/g, '\n').replace(/\\r/g, '');

        // 2. Extract ONLY the base64 content
        // We remove headers, then strip EVERY character that isn't valid base64 (A-Z, a-z, 0-9, +, /, =)
        let body = key
            .replace(/-----BEGIN[^-]+-----/g, '')
            .replace(/-----END[^-]+-----/g, '')
            .replace(/[^a-zA-Z0-9+/=]/g, ''); 

        if (body.length < 500) {
            console.error(`[PEM Doctor] CRITICAL: Body too short after cleanup (${body.length} chars). Original: ${rawKey.length}`);
            return key;
        }

        // 3. Reconstruct into standard 64-char wrapped lines
        const lines = body.match(/.{1,64}/g) || [];
        
        // Strategy A: PKCS#8 (Standard for Google Service Accounts)
        const pkcs8 = [
            '-----BEGIN PRIVATE KEY-----',
            ...lines,
            '-----END PRIVATE KEY-----',
            ''
        ].join('\n');

        const { createPrivateKey } = require('crypto');
        try {
            createPrivateKey(pkcs8);
            console.log(`[PEM Doctor] Validation: SUCCESS (PKCS#8). Body: ${body.length}`);
            return pkcs8;
        } catch (err) {
            console.warn(`[PEM Doctor] PKCS#8 validation failed: ${err.message}. Trying PKCS#1...`);
        }

        // Strategy B: PKCS#1 (RSA Private Key)
        const pkcs1 = [
            '-----BEGIN RSA PRIVATE KEY-----',
            ...lines,
            '-----END RSA PRIVATE KEY-----',
            ''
        ].join('\n');

        try {
            createPrivateKey(pkcs1);
            console.log(`[PEM Doctor] Validation: SUCCESS (PKCS#1). Body: ${body.length}`);
            return pkcs1;
        } catch (err) {
            console.error(`[PEM Doctor] PKCS#1 validation failed: ${err.message}.`);
        }

        // Final Fallback: Return original with only newline normalization
        console.warn("[PEM Doctor] Reconstructions failed. Using raw unescaped input.");
        return key;
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

        // Use the robust standardization
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

    async shareFile(fileId, email, role = 'writer') {
        await this.init();
        try {
            console.log(`[Google] Sharing file ${fileId} with ${email} (role: ${role})...`);
            const response = await this.drive.permissions.create({
                fileId,
                sendNotificationEmail: true,
                resource: {
                    type: 'user',
                    role,
                    emailAddress: email
                }
            });
            console.log(`[Google] Permission created: ${response.data.id}`);
            return response.data;
        } catch (err) {
            console.error('[Google] Error sharing file:', err.message);
            throw err;
        }
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
