/**
 * Google Drive and Calendar integration module
 */
const { google } = require('googleapis');
const { defineSecret } = require('firebase-functions/params');

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

// Секрет с JSON-ключом сервисного аккаунта
const GOOGLE_SERVICE_ACCOUNT_JSON = defineSecret('GOOGLE_SERVICE_ACCOUNT_JSON');

class GoogleService {
    constructor() {
        this.drive = null;
        this.calendar = null;
        this.auth = null;
    }

    async init() {
        if (this.auth) return;

        let rawJson;
        try {
            rawJson = GOOGLE_SERVICE_ACCOUNT_JSON.value();
        } catch (e) {
            console.log("Secret value not accessible via Firebase Params, trying direct Secret Manager API...");
            try {
                const [version] = await client.accessSecretVersion({
                    name: `projects/659700409826/secrets/GOOGLE_SERVICE_ACCOUNT_JSON/versions/latest`,
                });
                rawJson = version.payload.data.toString();
            } catch (err) {
                console.error("Direct Secret Manager access failed:", err);
                throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing and inaccessible!");
            }
        }

        let key;
        try {
            key = JSON.parse(rawJson);
        } catch (e) {
            // Если в секрете не JSON, а возможно экранированная строка, пробуем обработать
            console.error("JSON parse error for secret, trying fallback...");
            key = JSON.parse(rawJson.replace(/\\n/g, '\n'));
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
            // Если пришла просто дата, ставим на 1 час
            const start = new Date(startTime);
            const end = new Date(start.getTime() + 60 * 60 * 1000);

            const event = {
                'summary': title,
                'description': 'Создано ассистентом Гексли',
                'start': {
                    'dateTime': start.toISOString(),
                    'timeZone': 'UTC',
                },
                'end': {
                    'dateTime': end.toISOString(),
                    'timeZone': 'UTC',
                },
                'reminders': {
                    'useDefault': true
                },
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
}

module.exports = new GoogleService();
