
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
import { getSecret } from './src/secrets';

async function diag() {
    try {
        console.log("--- Gemini API Diagnostic ---");
        const key = await getSecret('GEMINI_API_KEY');
        if (!key) {
            console.error("Error: GEMINI_API_KEY is empty or not found.");
            return;
        }
        console.log(`API Key found (starts with: ${key.substring(0, 5)}...)`);
        
        const genAI = new GoogleGenerativeAI(key);
        
        // We use a lower-level fetch or a trick because the SDK might not have a direct listModels in some versions
        // but let's try the common patterns first.
        // Actually, the most reliable way to check a model is to try a very simple call to it.
        
        const testModels = ["gemini-pro", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.0-pro", "gemini-1.5-flash-latest"];
        
        for (const m of testModels) {
            try {
                const model = genAI.getGenerativeModel({ model: m });
                const result = await model.generateContent("Hi");
                const response = await result.response;
                console.log(`[OK] Model '${m}' is WORKING. Response: ${response.text().substring(0, 20)}...`);
            } catch (err: any) {
                console.log(`[FAIL] Model '${m}' failed: ${err.message}`);
            }
        }
        
    } catch (err: any) {
        console.error("Diagnostic failed:", err.message);
    }
}

diag();
