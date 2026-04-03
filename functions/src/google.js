const { google } = require('googleapis');
const { getSecret } = require('./secrets');

class GoogleService {
    constructor() {
        this.drive = null;
        this.calendar = null;
        this.auth = null;
    }

    async init() {
        if (this.auth) return;

        const rawJson = await getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');

        let key;
        try {
            // 1. Direct parse (ideal case)
            key = JSON.parse(rawJson);
        } catch (e) {
            console.warn("[Google] Standard JSON parse failed, trying fallbacks...");
            try {
                // 2. Remove any "JSON" or code block wrappers if copied from a chat
                let cleaned = rawJson.replace(/```json|```/g, "").trim();
                // 3. Handle unescaped newlines and replace literal \n with real newlines for the private_key
                cleaned = cleaned.replace(/\r?\n/g, ""); // Remove real newlines first to flatten
                key = JSON.parse(cleaned);
            } catch (e2) {
                try {
                    // 4. Most aggressive: keep only printable characters and try to extract the JSON part
                    const start = rawJson.indexOf('{');
                    const end = rawJson.lastIndexOf('}');
                    if (start !== -1 && end !== -1) {
                        const extracted = rawJson.substring(start, end + 1);
                        key = JSON.parse(extracted);
                    } else {
                        throw new Error("No JSON object markers found.");
                    }
                } catch (e3) {
                    console.error("[Google] CRITICAL: Could not parse Service Account Secret.");
                    console.error("[Google] Raw length:", rawJson ? rawJson.length : 0);
                    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON format error.");
                }
            }
        }

        this.auth = new google.auth.JWT(
            key.client_email,
            null,
            key.private_key,
            ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/calendar']
        );

        this.drive = google.drive({ version: 'v3', auth: this.auth });
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log('Google Service authorized successfully.');
    }

    async createProjectFolder(projectName) {
        await this.init();
        try {
            const fileMetadata = {
                'name': projectName,
                'mimeType': 'application/vnd.google-apps.folder'
            };
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

    async addCalendarReminder(title, startTime) {
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
                calendarId: 'primary',
                resource: event,
            });
            console.log(`Event created: ${response.data.htmlLink}`);
            return response.data;
        } catch (err) {
            console.error('Error creating calendar event:', err);
            throw err;
        }
    }

    async listCalendarEvents(maxResults = 10) {
        await this.init();
        try {
            const response = await this.calendar.events.list({
                calendarId: 'primary',
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

    async searchDriveFiles(query = "", pageSize = 10) {
        await this.init();
        try {
            const response = await this.drive.files.list({
                q: query ? `name contains '${query}'` : "trashed = false",
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
