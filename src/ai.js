import { DatabaseClient } from './db.js';

const QUOTA_LIMITS = {
    'gemini-3.1-flash-lite-preview': 500,
    'gemini-3.5-flash': 20,
    'gemini-3-flash-preview': 20,
    'gemini-2.5-flash': 1500,
    'gemini-2.5-flash-lite': 20,
    'gemma-4-31b-it': 1500,
    'gemma-4-26b-a4b-it': 1500,
    'gemini-3.1-flash-tts-preview': 10,
    'gemini-2.5-flash-preview-tts': 10
};

// Chains of model names
export const CHAINS = {
    chat: [
        'models/gemini-3.1-flash-lite-preview',
        'models/gemini-3.5-flash',
        'models/gemini-3-flash-preview',
        'models/gemini-2.5-flash',
        'models/gemini-2.5-flash-lite',
        'models/gemma-4-31b-it',
        'models/gemma-4-26b-a4b-it'
    ],
    vision: [
        'models/gemini-3.5-flash',
        'models/gemini-3.1-flash-lite-preview',
        'models/gemini-3-flash-preview',
        'models/gemini-2.5-flash',
        'models/gemini-2.5-flash-lite'
    ],
    tts: [
        'models/gemini-3.1-flash-tts-preview',
        'models/gemini-2.5-flash-preview-tts'
    ],
    search: [
        'models/gemini-2.5-flash',
        'models/gemini-2.5-flash-lite'
    ]
};

export class AIRouter {
    constructor(db, ai, geminiKey) {
        this.dbClient = new DatabaseClient(db);
        this.ai = ai;
        this.geminiKey = geminiKey;
    }

    /**
     * Executes a Google Gemini API request with fallback chain logic.
     */
    async executeChain(chainName, payloadModifier, initialPayload = {}) {
        const chain = CHAINS[chainName];
        if (!chain) {
            throw new Error(`Chain ${chainName} not found.`);
        }

        // Get daily counts from D1 to verify local quota limits
        const usages = await this.dbClient.getQuotaUsage();
        const usageMap = {};
        usages.forEach(u => {
            usageMap[u.model_name] = u.daily_count;
        });

        for (const modelId of chain) {
            const shortName = modelId.replace('models/', '');
            const currentCount = usageMap[shortName] || 0;
            const limit = QUOTA_LIMITS[shortName] || 20;

            // 1. Local Quota Check
            if (currentCount >= limit) {
                console.warn(`Local quota reached for ${shortName} (${currentCount}/${limit}). Trying next model...`);
                continue;
            }

            try {
                console.log(`Trying model: ${modelId} for ${chainName} (Quota: ${currentCount}/${limit})...`);
                
                // 2. Modify the payload specifically for this model
                const payload = payloadModifier(modelId, { ...initialPayload });
                
                // 3. Make HTTP Fetch call to Google AI Studio
                const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${this.geminiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.warn(`Model ${modelId} failed: ${response.status} - ${errText}`);
                    if (response.status === 429) {
                        // Rate limit, proceed to fallback
                        continue;
                    }
                    throw new Error(`Google API ${response.status}: ${errText}`);
                }

                const result = await response.json();
                
                // 4. Increment quota count in D1 on success
                await this.dbClient.incrementQuota(shortName);
                
                return { result, modelId };

            } catch (err) {
                console.error(`Error executing ${modelId} in ${chainName}:`, err.message);
                // Continue to next model in the chain
            }
        }

        // 5. Ultimate fallback to Cloudflare Workers AI if the chain is 'chat'
        if (chainName === 'chat' && this.ai) {
            console.log("Ultimate Fallback: Using Cloudflare Workers AI Llama-3.2...");
            try {
                const messages = initialPayload.contents.map(c => ({
                    role: c.role || 'user',
                    content: c.parts[0].text
                }));

                const cfResult = await this.ai.run('@cf/meta/llama-3.2-3b-instruct', { messages });
                const text = cfResult.response;

                return {
                    result: {
                        candidates: [{
                            content: { parts: [{ text }] }
                        }]
                    },
                    modelId: 'cloudflare/@cf/meta/llama-3.2-3b-instruct'
                };
            } catch (cfErr) {
                console.error("Workers AI ultimate fallback failed:", cfErr);
            }
        }

        throw new Error(`All models in chain ${chainName} failed or quotas exhausted.`);
    }

    /**
     * General Text Chat method.
     */
    async generateChat(messages) {
        // Format messages for Gemini API
        const contents = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        const modifier = (modelId, payload) => {
            payload.contents = contents;
            return payload;
        };

        const { result, modelId } = await this.executeChain('chat', modifier);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { text, modelId };
    }

    /**
     * Web Search Grounding method using Gemini 2.5.
     */
    async generateSearch(query) {
        const contents = [{
            parts: [{ text: query }]
        }];

        const modifier = (modelId, payload) => {
            payload.contents = contents;
            payload.tools = [{ googleSearch: {} }];
            return payload;
        };

        const { result, modelId } = await this.executeChain('search', modifier);
        const candidate = result.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || '';
        const metadata = candidate?.groundingMetadata;

        return { text, metadata, modelId };
    }

    /**
     * Text-To-Speech audio generator.
     */
    async generateTts(text) {
        const contents = [{
            parts: [{ text }]
        }];

        const modifier = (modelId, payload) => {
            payload.contents = contents;
            payload.generationConfig = {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: "Kore" // Aoede, Charon, Fenrir, Kore, Puck
                        }
                    }
                }
            };
            return payload;
        };

        const { result, modelId } = await this.executeChain('tts', modifier);
        const part = result.candidates?.[0]?.content?.parts?.[0];
        
        if (part?.inlineData) {
            return {
                audioBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType,
                modelId
            };
        }
        throw new Error("No audio bytes returned by TTS model.");
    }

    /**
     * Image/Vision analyzer.
     */
    async generateVision(textPrompt, imageBase64, mimeType) {
        const contents = [{
            parts: [
                { text: textPrompt },
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: imageBase64
                    }
                }
            ]
        }];

        const modifier = (modelId, payload) => {
            payload.contents = contents;
            return payload;
        };

        const { result, modelId } = await this.executeChain('vision', modifier);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { text, modelId };
    }

    /**
     * Semantic Brain Router: Classifies user intent.
     */
    async classifyIntent(messageText) {
        const systemPrompt = `You are the routing brain of an assistant bot. Based on the user message, classify the user's intent into EXACTLY ONE of these categories:
- CHAT: General questions, greetings, programming assistance, or conversational questions.
- BULK_ACTION: If the user replies to a task/reminder list and asks to "register", "add", "store", or similar.
- SEARCH: If the user asks for live/current information (e.g., news, weather, time, live prices, today's sports) requiring web search.
- TTS: If the user explicitly asks the bot to speak, say, read, voice-note, or read aloud.

Respond with ONLY the category name. Do not explain.
User Message: "${messageText}"
Intent:`;

        // 1. Try Cloudflare Workers AI first
        if (this.ai) {
            try {
                console.log("Using Cloudflare Workers AI Llama-3.2 for intent classification...");
                const cfResult = await this.ai.run('@cf/meta/llama-3.2-3b-instruct', {
                    messages: [
                        { role: 'user', content: systemPrompt }
                    ]
                });
                const intent = cfResult.response?.trim().toUpperCase();
                if (['CHAT', 'BULK_ACTION', 'SEARCH', 'TTS'].includes(intent)) {
                    console.log(`Intent classified by Workers AI: ${intent}`);
                    return intent;
                }
            } catch (err) {
                console.error("Workers AI intent classification failed, trying fallback...", err);
            }
        }

        // 2. Fallback to Gemma 4 via Google AI Studio
        console.log("Using Gemma 4 via Google AI Studio for intent classification...");
        const contents = [{
            parts: [{ text: systemPrompt }]
        }];

        // Gemma Fallback Chain
        for (const modelId of ['models/gemma-4-31b-it', 'models/gemma-4-26b-a4b-it']) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${this.geminiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });

                if (response.ok) {
                    const data = await response.json();
                    const intent = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();
                    if (intent && ['CHAT', 'BULK_ACTION', 'SEARCH', 'TTS'].includes(intent)) {
                        console.log(`Intent classified by ${modelId}: ${intent}`);
                        return intent;
                    }
                }
            } catch (err) {
                console.error(`Gemma classification on ${modelId} failed:`, err);
            }
        }

        // Default fallback
        return 'CHAT';
    }

    /**
     * Parses bulk tasks or reminders from text.
     */
    async parseBulkInput(bulkText) {
        const systemPrompt = `You are a structured parser. Read the user message containing a list of tasks or reminders, and extract them into a single clean JSON object.
Rules:
- Assign tasks to usernames if mentioned (e.g. "@username" or "username").
- Relative times for reminders should be like: "10m", "2h", "1d" or absolute "15:30".
- Response must be raw JSON only. Do not wrap in markdown or backticks.

Example Output:
{
  "tasks": [
    { "title": "Design landing page", "assignee": "Ali" }
  ],
  "reminders": [
    { "text": "Call client", "time": "15m" }
  ]
}

User input:
"${bulkText}"`;

        // Try Llama-3.2 first
        if (this.ai) {
            try {
                const cfResult = await this.ai.run('@cf/meta/llama-3.2-3b-instruct', {
                    messages: [{ role: 'user', content: systemPrompt }]
                });
                const cleanJson = this.extractJson(cfResult.response);
                if (cleanJson) return cleanJson;
            } catch (e) {
                console.error("Workers AI bulk parser failed:", e);
            }
        }

        // Fallback to Gemma
        for (const modelId of ['models/gemma-4-31b-it', 'models/gemma-4-26b-a4b-it']) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${this.geminiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
                });

                if (response.ok) {
                    const data = await response.json();
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    const cleanJson = this.extractJson(text);
                    if (cleanJson) return cleanJson;
                }
            } catch (e) {
                console.error("Gemma bulk parser failed:", e);
            }
        }

        return { tasks: [], reminders: [] };
    }

    extractJson(text) {
        if (!text) return null;
        try {
            // Find JSON start and end
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1) {
                const jsonStr = text.substring(start, end + 1);
                return JSON.parse(jsonStr);
            }
        } catch (e) {
            console.error("Failed to parse JSON string from model response:", text);
        }
        return null;
    }
}
