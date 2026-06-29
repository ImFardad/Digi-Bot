# Digi-Bot Assistant: Project Plan & Architecture

Digi-Bot is a smart, serverless group assistant bot for Telegram, built to run on **Cloudflare Workers** using **JavaScript (ES Modules)** and **Cloudflare D1** as the database. It is designed to assist work groups with task management, smart reminders, vision analysis, and text-to-speech features.

---

## 1. System Architecture

The project leverages a fully serverless, edge-computed stack to ensure low latency and high availability:

- **Runtime & Framework:** Cloudflare Workers running [Hono](https://hono.dev/) framework (JavaScript).
- **Database:** Cloudflare D1 (Serverless SQLite database) for storing tasks, reminders, settings, and daily quotas.
- **Cache & Lock:** Cloudflare KV (Key-Value) for quick session caching, locks, and configuration.
- **Background Tasks:** Cloudflare Workers Cron Triggers running every minute to process pending reminders.
- **AI Engine (Hybrid & Fallback):**
  - **Google AI Studio (Gemini/Gemma):** For main text responses, vision analysis, and text-to-speech.
  - **Cloudflare Workers AI:** For ultra-fast semantic routing, local model fallbacks, and bulk action parsing.

---

## 2. Dynamic AI Model Fallback Chains

To maximize daily API quotas and ensure 100% uptime, all tested AI models are arranged in fallback chains (ordered from strongest/fastest to weakest). If a model fails (due to a rate limit or server error), the bot instantly switches to the next model in the chain.

### A. General Text & Chat Chain (`chat_chain`)
Processes tagged group messages, direct questions, and chat conversations.
1. **`gemini-3.1-flash-lite-preview`** (Primary - Fast, 500 RPD)
2. **`gemini-3.5-flash`** (High intelligence, 20 RPD)
3. **`gemini-3-flash-preview`** (20 RPD)
4. **`gemini-2.5-flash`** (20 RPD)
5. **`gemini-2.5-flash-lite`** (20 RPD)
6. **`gemma-4-31b-it`** (Very strong, but placed lower due to slower response speed - 1500 RPD)
7. **`gemma-4-26b-a4b-it`** (Strong, placed lower due to slower speed - 1500 RPD)
8. **Cloudflare Workers AI** (`@cf/meta/llama-3.2-3b-instruct` - Ultimate fallback)

### B. Image & Document Analysis Chain (`vision_chain`)
Triggered when a photo/document is sent and the bot is tagged or replied to.
1. **`gemini-3.5-flash`** (Primary - High quality vision, 20 RPD)
2. **`gemini-3.1-flash-lite-preview`** (Fast vision, 500 RPD)
3. **`gemini-3-flash-preview`** (20 RPD)
4. **`gemini-2.5-flash`** (20 RPD)
5. **`gemini-2.5-flash-lite`** (20 RPD)

### C. Text-To-Speech Chain (`tts_chain`)
Triggered by the `/say [text]` or `/voice [text]` command to send a spoken voice message.
1. **`gemini-3.1-flash-tts-preview`** (Primary - 10 RPD)
2. **`gemini-2.5-flash-preview-tts`** (Fallback - 10 RPD)

### D. Google Search Grounding Chain (`search_chain`)
Triggered by the `/search [query]` command or when the user asks for live/real-time information.
1. **`gemini-2.5-flash`** (Primary - Supports Search Grounding, 1500 RPD)
2. **`gemini-2.5-flash-lite`** (Fallback - 500 RPD)

### E. Bulk Task & Reminder Parser (`bulk_action_chain`)
Used to parse complex lists of tasks or reminders in user messages via tool calling.
1. **Workers AI Llama-3.1-8B** (Primary - Instant, cost-free)
2. **`gemma-4-31b-it`** (1500 RPD)
3. **`gemma-4-26b-a4b-it`** (1500 RPD)

### F. Semantic Brain Router Chain (`brain_router_chain`)
Used to classify user intent when natural language mentions or replies are received.
1. **Cloudflare Workers AI** (`@cf/meta/llama-3.2-3b-instruct` - Primary, fast, edge-computed)
2. **`gemma-4-31b-it`** (Fallback 1 - High quota, 1500 RPD)
3. **`gemma-4-26b-a4b-it`** (Fallback 2 - High quota, 1500 RPD)

### G. Gemini Live WebApp Voice Call Chain (`live_call_chain`)
Triggered when the user invokes the `/call` command. Opens a Telegram WebApp voice session.
1. **`gemini-3.1-flash-live-preview`** (Primary - Full real-time audio/text bidirectional streaming, Unlimited RPD)

---

## 3. Key Features

### A. Intent Router & Execution Modes
The bot runs in one of two modes depending on how the request is received:

#### 1. Direct Mode (Command-Based - Bypasses the Brain)
- **Trigger:** Explicit Telegram commands (e.g., `/search [query]`, `/say [text]`, `/tasks`, `/tasks_all`) or direct media uploads (images).
- **Execution:** The bot bypasses the Brain Router completely, goes straight to the corresponding pipeline (e.g., `search_chain` for search, `tts_chain` for text-to-speech, `vision_chain` for images).
- **Post-processing:** If needed, a text model (like `gemini-3.1-flash-lite`) takes the raw results, formats them into a clean Telegram message, and sends it.

#### 2. Semantic Mode (Brain-Based - Natural Language Router)
- **Trigger:** Natural language tags (e.g., `@bot ...`) or replies to the bot.
- **Execution:** The message is processed by the **Semantic Brain Router Chain** (`brain_router_chain`), using Cloudflare Workers AI Llama-3 first, and falling back to Gemma 4 models if the Cloudflare quota is exhausted.
- **Intent Classification:** The Brain classifies the user's intent into one of the supported actions:
  - `CHAT`: General conversational assistance (routed to `chat_chain`).
  - `BULK_ACTION`: Extracting tasks or reminders from a replied-to message (routed to `bulk_action_chain`).
  - `SEARCH`: Real-time web search (routed to `search_chain`).
  - `TTS`: Speaking out a text (routed to `tts_chain`).
  - `VISION`: Processing an image attached (routed to `vision_chain`).
- **Resolution:** The bot runs the classified tool, formats the response, and sends it to Telegram.

### B. Smart Task Tracker (D1 Database)
- **`/tasks`:** Lists active tasks assigned to the sender.
- **`/tasks_all`:** Lists all active group tasks grouped by team members.
- **Status Toggle:** When a user replies with "done" or "تسک من تمومه", the bot updates the status:
  - If they have only 1 active task, it marks it complete.
  - If they have multiple tasks, it displays inline buttons listing their tasks to let them select which one is complete.

### C. Time-Aware Reminders (Iran Timezone & Hijri Calendar)
- **Tehran Timezone (`Asia/Tehran`):** All dates parsed and formatted using Iran's timezone.
- **Solar Hijri (Shamsi) Support:** Natively formatted and printed using `Intl.DateTimeFormat` for full compatibility with Iranian calendar days.
- **Time Awareness Tool:** When using the AI to parse reminders, the bot provides a tool `get_current_iran_time_and_date` so the AI knows the exact current time in Iran and calculates absolute deadlines correctly.

### D. Quota Tracking
Daily API calls for each Google model are tracked in D1. If a model reaches 90% of its quota, it triggers a warning in the group and dynamically switches to the next fallback model.

### E. Real-time Voice Calls (Telegram WebApp & Gemini Live)
- **`/call` Command:** Triggers a message with a custom Telegram WebApp button (e.g., "Start Call").
- **Voice Interface:** Clicking it opens a beautiful, animated voice call modal inside Telegram.
- **WebSocket Streaming:** The WebApp secures a session token and opens a direct WebSocket connection (using Client-Side WebRTC/WebSocket) to the Gemini Live API via `gemini-3.1-flash-live-preview`.
- **Low Latency Conversation:** The user can speak to the bot, and the bot streams back audio in real-time, creating a low-latency, natural voice call experience directly on their phone.

---

## 4. D1 Database Schema

```sql
-- Active Tasks Table
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assigned_to_username TEXT, -- Telegram Username
    assigned_to_id INTEGER,    -- Telegram ID
    status TEXT DEFAULT 'todo', -- todo, done
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Active Reminders Table
CREATE TABLE reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    remind_at TIMESTAMP NOT NULL, -- Stored as UTC timestamp
    is_sent INTEGER DEFAULT 0
);

-- API Quota Logs Table
CREATE TABLE quota_usage (
    model_name TEXT PRIMARY KEY,
    daily_count INTEGER DEFAULT 0,
    last_reset_date TEXT
);
```
