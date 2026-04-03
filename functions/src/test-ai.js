const { getSecret } = require('./secrets');
const { GoogleGenAI } = require('@google/genai');

async function test() {
    try {
        const key = await getSecret('GEMINI_API_KEY');
        const genAI = new GoogleGenAI({ apiKey: key });
        
        console.log("Sending test ping to gemini-2.0-flash-exp...");
        const result = await genAI.models.generateContent({
            model: "gemini-2.0-flash-exp",
            contents: [{ role: 'user', parts: [{ text: "Hello, are you there?" }] }]
        });
        
        console.log("Response:", result.candidates[0].content.parts[0].text);
        console.log("SUCCESS");
    } catch (e) {
        console.error("FAILURE:", e.message);
        if (e.response) {
            console.error("Response info:", e.response.status, e.response.statusText);
        }
    }
}

test();
