const { getSecret } = require('./secrets');
const https = require('https');

async function checkWebhook() {
    try {
        const token = await getSecret('TELEGRAM_BOT_TOKEN');
        const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
        
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const info = JSON.parse(data);
                console.log("Current Webhook Info:", JSON.stringify(info, null, 2));
            });
        }).on('error', (e) => {
            console.error("FAILURE:", e.message);
        });
    } catch (e) {
        console.error("SECRET ERROR:", e.message);
    }
}

checkWebhook();
