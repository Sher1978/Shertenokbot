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
            // 1. First, try to extract the JSON object with a regex to ignore any wrapping text/backticks
            const match = rawJson.match(/\{[\s\S]*\}/);
            if (!match) throw new Error("No curly braces found in secret string.");
            
            let jsonString = match[0];
            
            // 2. Try simple parse on the extracted part
            try {
                key = JSON.parse(jsonString);
            } catch (innerErr) {
                // 3. Fallback: handle common unescaped newline issues in the private_key specifically
                // This is risky but often fixes manually pasted PKCS8 keys.
                console.warn("[Google] Inner parse failed, trying character cleanup...");
                // Keep only printable ASCII and common white space
                const cleaned = jsonString.replace(/[^\x20-\x7E\r\n\t]/g, "");
                key = JSON.parse(cleaned);
            }
        } catch (e) {
            console.error("[Google] CRITICAL: Service Account Secret parsing failed.");
            console.error("[Google] Hint: Ensure GOOGLE_SERVICE_ACCOUNT_JSON in Secret Manager is valid JSON.");
            console.error("[Google] Raw length:", rawJson ? rawJson.length : 0);
            throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON format error.");
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
