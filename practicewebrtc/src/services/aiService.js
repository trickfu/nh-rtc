import OpenAI from 'openai';

const apiKey = process.env.REACT_APP_OPENROUTER_API_KEY;

if (!apiKey || apiKey === 'your_key_here') {
    console.error("CRITICAL: OpenRouter API Key is missing or still set to placeholder 'your_key_here'. Please update .env and restart the server.");
}

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey,
    dangerouslyAllowBrowser: true // Required since we're running in React
});

export const analyzeText = async (text) => {
    try {
        const completion = await openai.chat.completions.create({
            model: 'x-ai/grok-4-fast',
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
        });

        const content = completion.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error("AI Analysis Error:", error);
        return null;
    }
};
