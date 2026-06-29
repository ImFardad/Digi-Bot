# Digi-Bot Assistant: API Usage Documentation

This document describes how to make direct HTTP API requests to Google AI Studio (Gemini/Gemma) and Cloudflare Workers AI, configure Text-to-Speech (TTS), implement tool calling, and convert raw PCM audio to playable WAV files inside Cloudflare Workers.

---

## 1. Google AI Studio API (Gemini / Gemma)

All requests use the standard Google AI Studio endpoint format:
`https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}?key={apiKey}`

### A. General Text Chat (`generateContent`)
Used for generating text answers using Gemini or Gemma models.

- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=YOUR_API_KEY`
- **Headers:** `Content-Type: application/json`
- **Request Payload:**
```json
{
  "contents": [
    {
      "parts": [
        { "text": "Who are you?" }
      ]
    }
  ]
}
```

### B. Vision Analysis (`generateContent` with image)
Used for analyzing images using multimodal models like `gemini-3.5-flash` or `gemini-3.1-flash-lite`.

- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=YOUR_API_KEY`
- **Request Payload:**
```json
{
  "contents": [
    {
      "parts": [
        { "text": "Describe this image in detail." },
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "BASE64_ENCODED_IMAGE_BYTES"
          }
        }
      ]
    }
  ]
}
```

### C. Text-To-Speech (`generateContent` with Audio modality)
Used for converting text into voice messages. Both `gemini-3.1-flash-tts-preview` and `gemini-2.5-flash-preview-tts` require specifying `responseModalities` and `speechConfig`.

- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=YOUR_API_KEY`
- **Request Payload:**
```json
{
  "contents": [
    {
      "parts": [
        { "text": "Say 'Welcome to Digi-Bot' in a short spoken format." }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "voiceConfig": {
        "prebuiltVoiceConfig": {
          "voiceName": "Kore"
        }
      }
    }
  }
}
```

### D. Google Search Grounding
Used for web search queries to retrieve real-time grounded information. Gemini 2.5 Flash supports Search Grounding with a generous quota.

- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=YOUR_API_KEY`
- **Request Payload:**
```json
{
  "contents": [
    {
      "parts": [
        { "text": "What is the latest news in Tehran today?" }
      ]
    }
  ],
  "tools": [
    {
      "googleSearch": {}
    }
  ]
}
```
- **Response Format:**
The response candidates contain a `groundingMetadata` block containing search queries and web source links (URIs and titles):
```json
{
  "candidates": [
    {
      "content": {
        "parts": [{ "text": "Grounded answer text..." }]
      },
      "groundingMetadata": {
        "webSearchQueries": ["latest news Tehran today"],
        "groundingChunks": [
          {
            "web": {
              "uri": "https://aljazeera.com/...",
              "title": "Al Jazeera News Page"
            }
          }
        ]
      }
    }
  ]
}
```

### E. Gemini Live API (BidiGenerateContent WebSocket)
Used for bidirectional, real-time audio and text streaming. Gemini 3.1 Flash Live is supported using the `gemini-3.1-flash-live-preview` model.

- **WebSocket URL (v1beta):** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=YOUR_API_KEY`
- **Modality constraint:** Must use `"AUDIO"` as response modality.

#### 1. Setup Session (Must be the first message)
Send this JSON payload right after opening the socket:
```json
{
  "setup": {
    "model": "models/gemini-3.1-flash-live-preview",
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "speechConfig": {
        "voiceConfig": {
          "prebuiltVoiceConfig": {
            "voiceName": "Kore"
          }
        }
      }
    }
  }
}
```

#### 2. Parsing the Server Response (Blob Handling)
Gemini Live API sends both control messages and audio data inside **binary frames (Blobs)**. In Javascript/Node.js, you must read the Blob as text first to parse the JSON:
```javascript
ws.onmessage = async (event) => {
    if (event.data instanceof Blob) {
        const rawText = await event.data.text();
        const data = JSON.parse(rawText);
        
        if (data.setupComplete) {
            console.log("Session setup is successful!");
        }
        
        // Handle incoming audio data
        const serverContent = data.serverContent;
        if (serverContent?.modelTurn?.parts) {
            for (const part of serverContent.modelTurn.parts) {
                if (part.inlineData) {
                    const base64Audio = part.inlineData.data; // Raw PCM audio in base64
                    const mime = part.inlineData.mimeType; // e.g. "audio/pcm;rate=24000"
                    // Play or buffer audio...
                }
            }
        }
        
        if (serverContent?.turnComplete) {
            console.log("Model finished speaking.");
        }
    }
};
```

#### 3. Sending Conversational Turn (Client Content)
To send a text/audio prompt to the active session:
```json
{
  "clientContent": {
    "turns": [
      {
        "role": "user",
        "parts": [
          { "text": "Hello Gemini Live! Say something." }
        ]
      }
    ],
    "turnComplete": true
  }
}
```

---

## 2. Tool Calling (Function Calling)

To make the AI aware of the current date and time in Iran, we provide the `get_current_iran_time_and_date` tool.

### Request Payload with Tool definition
```json
{
  "contents": [
    {
      "parts": [
        { "text": "Remind me tomorrow at 5 PM to send the reports." }
      ]
    }
  ],
  "tools": [
    {
      "functionDeclarations": [
        {
          "name": "get_current_iran_time_and_date",
          "description": "Returns the exact current date, time, and day of the week in Iran (Asia/Tehran timezone) in both Solar Hijri (Shamsi) and Gregorian formats."
        }
      ]
    }
  ]
}
```

### Response Example (Tool Call)
If the model decides to call the tool, it returns a `functionCall` instead of plain text:
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "functionCall": {
              "name": "get_current_iran_time_and_date",
              "args": {}
            }
          }
        ]
      }
    }
  ]
}
```

---

## 3. Cloudflare Workers AI API

Cloudflare Workers AI can be invoked directly inside the Worker script via the `@cloudflare/ai` binding or through fetch requests.

### Using Worker Bindings
Define the AI binding in `wrangler.toml`:
```toml
[ai]
binding = "AI"
```

In JavaScript code:
```javascript
const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
    messages: [
        { role: 'user', content: 'Classify this intent: "Remind me in 5 minutes to call Ali"' }
    ]
});
```

---

## 4. Converting Raw PCM to WAV in Cloudflare Workers

Gemini TTS returns raw PCM audio bytes. Since Telegram requires a standard playable format like WAV or MP3, we prefix the PCM data with a 44-byte RIFF WAV header using standard JavaScript:

```javascript
/**
 * Wraps raw PCM buffer inside a WAV file header
 * @param {ArrayBuffer} pcmBuffer Raw PCM data
 * @param {number} sampleRate e.g. 24000
 * @param {number} numChannels e.g. 1
 * @param {number} bitsPerSample e.g. 16
 * @returns {ArrayBuffer} Completed WAV file buffer
 */
export function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
    const buffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
    const view = new DataView(buffer);

    // Helpers to write text tags
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    /* RIFF identifier */
    writeString(0, 'RIFF');
    /* File length (36 + data length) */
    view.setUint32(4, 36 + pcmBuffer.byteLength, true);
    /* RIFF type */
    writeString(8, 'WAVE');
    /* Format chunk identifier */
    writeString(12, 'fmt ');
    /* Format chunk length */
    view.setUint32(16, 16, true);
    /* Sample format (Raw PCM = 1) */
    view.setUint16(20, 1, true);
    /* Channel count */
    view.setUint16(22, numChannels, true);
    /* Sample rate */
    view.setUint32(24, sampleRate, true);
    /* Byte rate = (sampleRate * numChannels * bitsPerSample) / 8 */
    view.setUint32(28, (sampleRate * numChannels * bitsPerSample) / 8, true);
    /* Block align = (numChannels * bitsPerSample) / 8 */
    view.setUint16(32, (numChannels * bitsPerSample) / 8, true);
    /* Bits per sample */
    view.setUint16(34, bitsPerSample, true);
    /* Data chunk identifier */
    writeString(36, 'data');
    /* Data chunk length */
    view.setUint32(40, pcmBuffer.byteLength, true);

    // Copy raw PCM data right after header
    const pcmView = new Uint8Array(pcmBuffer);
    const wavView = new Uint8Array(buffer, 44);
    wavView.set(pcmView);

    return buffer;
}
```

This WAV file can then be uploaded to Telegram:
```javascript
const wavBuffer = pcmToWav(pcmData, 24000, 1, 16);
const blob = new Blob([wavBuffer], { type: 'audio/wav' });

const formData = new FormData();
formData.append('chat_id', chatId);
formData.append('voice', blob, 'voice.wav');

await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVoice`, {
    method: 'POST',
    body: formData
});
```
