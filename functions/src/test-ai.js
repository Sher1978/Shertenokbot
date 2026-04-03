const { getSecret } = require('./secrets');
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test() {
    try {
        const key = await getSecret('GEMINI_API_KEY');
        const genAI = new GoogleGenerativeAI(key);
        
        console.log("Fetching models...");
        // This is a direct discovery call or just trying to initialize
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        console.log("Model initialized. Sending test ping...");
        const result = await model.generateContent("Hello, are you there?");
        console.log("Response:", result.response.text());
        console.log("SUCCESS");
    } catch (e) {
        console.error("FAILURE:", e.message);
        if (e.response) {
            console.error("Response info:", e.response.status, e.response.statusText);
        }
    }
}

test();
