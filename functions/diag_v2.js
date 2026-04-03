const { GoogleGenerativeAI } = require('@google/generative-ai');

async function checkModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY not found in environment');
    return;
  }

  console.log('--- Testing with GEMINI_API_KEY (last 4 chars):', apiKey.slice(-4));
  
  // Test v1 (most stable)
  try {
    console.log('\n[v1] Attempting to list models...');
    const genAI = new GoogleGenerativeAI(apiKey);
    // Note: The SDK usually hides the version, but we can try different model strings
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("test");
    console.log('[v1] Success with gemini-1.5-flash');
  } catch (e) {
    console.log('[v1] Error with gemini-1.5-flash:', e.message);
  }

  // Fallback check: List models if possible
  // Note: Standard SDK might not have a direct listModels without REST call,
  // but we can try the most basic 'gemini-pro'
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent("test");
    console.log('[v1?] Success with gemini-pro');
  } catch (e) {
    console.log('[v1?] Error with gemini-pro:', e.message);
  }
}

checkModels().catch(console.error);
