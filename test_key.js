const { getSecret, parseJsonSecret } = require('./functions/src/secrets');
const { JWT } = require('google-auth-library');
const { createPrivateKey } = require('crypto');

async function test() {
    process.env.GCLOUD_PROJECT = 'sarafun-f9616';
    const rawJsonSecret = await getSecret('GOOGLE_SERVICE_ACCOUNT_JSON');
    const serviceAccount = parseJsonSecret(rawJsonSecret);
    
    let key = serviceAccount.private_key;
    
    // First try raw
    try {
        createPrivateKey(key);
        console.log("Raw key works directly!");
    } catch (e) {
        console.log("Raw key failed:", e.message);
        
        // Also sometimes JSON parses \n as literal \\n if it was double escaped
        try {
            const unescaped = key.replace(/\\n/g, '\n');
            createPrivateKey(unescaped);
            console.log("Unescaped key works directly!");
            key = unescaped;
        } catch (e2) {
            console.log("Unescaped also failed:", e2.message);
        }
    }
}

test().catch(console.error);
