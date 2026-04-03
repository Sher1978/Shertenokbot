
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSecret } = require('./src/secrets');

async function diag() {
    try {
        console.log("--- Gemini API Diagnostic (JS) ---");
        const key = await getSecret('GEMINI_API_KEY');
        if (!key) {
            console.error("Error: GEMINI_API_KEY is empty or not found.");
            return;
        }
        console.log(`API Key found (starts with: ${key.substring(0, 5)}...)`);
        
        const genAI = new GoogleGenerativeAI(key);
        
        const testModels = [
            "gemini-pro", 
            "gemini-1.5-flash", 
            "gemini-1.5-pro", 
            "gemini-1.0-pro", 
            "gemini-1.5-flash-latest",
            "gemini-2.0-flash-exp"
        ];
        
        for (const m of testModels) {
            try {
                process.stdout.write(`Checking model '${m}'... `);
                const model = genAI.getGenerativeModel({ model: m });
                const result = await model.generateContent("Hi");
                const response = await result.response;
                console.log(`[OK] WORKING. Response: ${response.text().substring(0, 10)}...`);
            } catch (err) {
                console.log(`[FAIL] Error: ${err.message}`);
                if (err.status) console.log(`       Status: ${err.status}`);
            }
        }
        
    } catch (err) {
        console.error("Diagnostic failed:", err.message);
    }
}

diag();
