const https = require('https');

const token = "8627860025:AAF5LevEeGDi4iBTpYrDb9bd101FC6DdMaA";
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
