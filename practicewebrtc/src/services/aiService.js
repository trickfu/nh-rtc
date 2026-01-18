import OpenAI from 'openai';

const apiKey = process.env.REACT_APP_OPENROUTER_API_KEY;

if (!apiKey || apiKey === 'your_key_here') {
    console.error("CRITICAL: OpenRouter API Key is missing or still set to placeholder 'your_key_here'. Please update .env and restart the server.");
} else {
    // Debug log to check the key (masked)
    console.log(`AiService: API Key configured. Length: ${apiKey.length}, Starts with: ${apiKey.substring(0, 7)}...`);
}

// Trim the key just in case there are hidden spaces from the .env file
const sanitizedApiKey = apiKey ? apiKey.trim() : '';

// Debug log to check the key (masked)
if (sanitizedApiKey) {
    console.log(`AiService: API Key configured. Length: ${sanitizedApiKey.length}, Starts with: ${sanitizedApiKey.substring(0, 7)}... Ends with: ...${sanitizedApiKey.slice(-4)}`);
}

export const analyzeText = async (text) => {
    try {
        console.log("Analyzing text via raw fetch...", text);

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${sanitizedApiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.origin, // Recommended by OpenRouter
                "X-Title": "Practicewebrtc", // Recommended by OpenRouter
            },
            body: JSON.stringify({
                model: "x-ai/grok-4-fast",
                messages: [
                    {
                        role: 'system',
                        content: `You are an entity extraction system.

Given a user utterance, remove all conversational filler and identify the
single referenced real-world entity.

Return ONLY valid JSON with:
- "name": canonical name
- "type": either "person" or "company"

Rules:
- Ignore verbs, politeness, hesitation, and filler
- If multiple entities are mentioned, choose the most likely primary one
- Capitalize names properly
- Do not include any extra text

Examples:

Input: "i want to talk to sam altman"
Output: {"name":"Sam Altman","type":"person"}

Input: "uh yeah maybe connect me to peter thiel"
Output: {"name":"Peter Thiel","type":"person"}

Input: "could you get me microsoft"
Output: {"name":"Microsoft","type":"company"}

Input: "roblox"
Output: {"name":"Roblox","type":"company"}`
                    },
                    {
                        role: 'user',
                        content: `Input: "${text}"`
                    }
                ],
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`OpenRouter API Error: ${response.status} ${response.statusText}`);
            console.error("Error Body:", errorBody);
            throw new Error(`OpenRouter API Error: ${response.status} - ${errorBody}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("AI Analysis Error:", error);
        return null;
    }
};
