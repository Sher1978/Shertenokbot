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

            try {
                key = JSON.parse(extracted);
                console.log(`[Google] Success: Service account for ${key.client_email} initialized.`);
            } catch (innerErr) {
                console.log(`[Google] JSON.parse failed: ${innerErr.message}. Attempting recovery...`);
                
                // RECOVERY: Fix common "bad escaped characters" (e.g. backslash before space or non-standard char)
                // Use a heuristic to only fix invalid escapes while keeping \n and \"
                let fixed = extracted
                    .replace(/\\(?!["\\\/bfnrtu])/g, '') // Remove backslash if NOT followed by valid JSON escape char
                    .replace(/\n/g, '\\n')             // Turn real newlines into escaped \n (common paste error)
                    .replace(/\r/g, '');               // Clean CR
                
                try {
                    key = JSON.parse(fixed);
                    console.log(`[Google] Success via Regex Recovery: Service account for ${key.client_email}`);
                } catch (recoveryErr) {
                    // FINAL FALLBACK: Manual extraction of key fields if JSON structure is totally shot
                    console.warn("[Google] Regex recovery failed. Reverting to field extraction fallback.");
                    const emailMatch = extracted.match(/"client_email"\s*:\s*"([^"]+)"/);
                    const keyMatch = extracted.match(/"private_key"\s*:\s*"([\s\S]+?)"/);
                    
                    if (emailMatch && keyMatch) {
                        key = {
                            client_email: emailMatch[1],
                            private_key: keyMatch[1].replace(/\\n/g, '\n').replace(/\n/g, '\n')
                        };
                        console.log(`[Google] Success via Field Extraction: ${key.client_email}`);
                    } else {
                        throw new Error(`JSON format error: ${innerErr.message}. Position suggested: 1230. Sample chars: ${extracted.substring(1220, 1240).split('').map(c=> `[${c}:${c.charCodeAt(0)}]`).join(' ')}`);
                    }
                }
            }
        } catch (e) {
            console.error("[Google] CRITICAL: Initialization failed:", e.message);
            throw e;
        }

        // OpenSSL 3 fix for Node.js 20: pass a KeyObject instead of a raw PEM string.
        // The old `jws` library (used inside google-auth-library) calls crypto.createSign(pem)
        // which fails with ERR_OSSL_UNSUPPORTED on PKCS#8 keys in OpenSSL 3.
        // Passing a pre-created KeyObject bypasses that legacy code path.
        const { createPrivateKey } = require('crypto');
        const { JWT } = require('google-auth-library');

        let privateKeyObject;
        try {
            privateKeyObject = createPrivateKey(key.private_key);
            console.log('[Google] Private key parsed as KeyObject successfully.');
        } catch (keyErr) {
            console.error('[Google] createPrivateKey failed:', keyErr.message);
            // If key has wrong newlines, try fixing them
            const fixedPem = key.private_key.replace(/\\n/g, '\n');
            privateKeyObject = createPrivateKey(fixedPem);
        }

        this.auth = new JWT({
            email: key.client_email,
            key: privateKeyObject,
            scopes: [
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/calendar'
            ]
        });

        this.drive = google.drive({ version: 'v3', auth: this.auth });
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
        console.log(`[Google] Service authorized as: ${key.client_email}`);

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
