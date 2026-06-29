# Digi-Bot: Project Phases & Roadmap

This document outlines the detailed roadmap for developing Digi-Bot. The project is split into 6 sequential phases, ensuring incremental testing and verification of all features.

---

## Phase 1: Project Setup & Telegram Webhook

Establish the core project foundation, setup the git repository, configure local/remote dependencies, and implement the Telegram Webhook receiver.

### Tasks
- [x] Git repository initialization and connection to GitHub remote (`ImFardad/Digi-Bot`).
- [x] Create project files (`README.md`, `.gitignore`, `docs/bot_plan.md`, `docs/api_usage.md`, `docs/deployment_guide.md`, `docs/project_phases.md`).
- [ ] Initialize `package.json` with Hono framework.
- [ ] Implement `src/telegram.js` wrapper using native `fetch` to interact with Telegram Bot API (methods like `sendMessage`, `sendVoice`, and `sendAudio`).
- [ ] Build the webhook endpoint `/webhook` in `src/index.js` to process incoming JSON payloads from Telegram.
- [ ] Implement Echo Bot logic for basic webhook connectivity testing.

### Deliverables
- A working Hono framework server running on Cloudflare Workers.
- A registered Telegram webhook that echoes back any received text.
- Clean GitHub repository state.

---

## Phase 2: D1 Database & Tasks/Reminders (with Iran Timezone)

Provision the SQLite database on Cloudflare D1, set up the task tracking commands, and write a background scheduler utilizing Cloudflare Cron Triggers to manage group reminders.

### Tasks
- [ ] Write SQL schema (`schema.sql`) for tasks, reminders, and daily API usage counters.
- [ ] Set D1 database bindings in `wrangler.toml` and configure the 1-minute `[triggers]` cron schedule.
- [ ] Write `src/db.js` helper methods for database operations (CRUDS for tasks/reminders, daily usage incrementers).
- [ ] Implement direct task commands in `src/tasks.js`:
  - `/tasks`: List active tasks assigned to the sender.
  - `/tasks_all`: List all active tasks grouped by user.
- [ ] Implement task completion interaction:
  - If a user sends "تسک من تمومه" or "done", change status to completed.
  - If multiple active tasks exist, return Telegram Inline Keyboard buttons to select the completed task.
- [ ] Implement direct reminder command parser in `src/reminders.js` (extract time relative to `Asia/Tehran` e.g., `/remind 10m call Ali` or `/remind 15:30 meeting`).
- [ ] Create the scheduled handler in `src/index.js` (Cron Trigger) to check D1 every minute for due reminders and post them to Telegram.

### Deliverables
- Fully functional local and remote D1 databases.
- Command-based task lists with inline button interactivity.
- Background cron runner delivering group reminders at precise times synced to Tehran timezone.

---

## Phase 3: Hybrid AI Routing & Semantic Brain

Configure the AI model clients (Google Gemini and Cloudflare Workers AI) and build the intent classifier router.

### Tasks
- [ ] Write Google AI Studio client in `src/ai.js` using raw `fetch` to communicate with Gemini/Gemma models.
- [ ] Write Cloudflare Workers AI client using standard `@cloudflare/ai` wrangler binding.
- [ ] Build fallback mechanism: Iterate through model array from strongest/fastest to weakest when a model returns a rate limit (HTTP 429) or error.
- [ ] Implement the Semantic Brain Router: If a user sends a text tag/reply, classify their intent into `CHAT`, `BULK_ACTION`, `SEARCH`, `TTS`, or `VISION` using Cloudflare's `@cf/meta/llama-3-8b-instruct`.
- [ ] Implement automatic Gemma fallback (`gemma-4-31b-it`) for classification if Cloudflare's free daily neuron quota is reached.

### Deliverables
- Clean abstraction layer for all AI engines in `src/ai.js`.
- AI-based intent routing that redirects group conversations to the correct tool.

---

## Phase 4: Advanced AI Features (Speech, Search, Vision)

Integrate speech synthesis, web searching, and image analysis into the bot's direct and semantic pipelines.

### Tasks
- [ ] **Text-To-Speech:** Implement `/say [text]` command. Query `gemini-3.1-flash-tts-preview` (with fallback to `gemini-2.5-flash-preview-tts`), construct a 44-byte WAV header in `src/audio.js` over the raw PCM bytes, and upload to Telegram `sendVoice`.
- [ ] **Web Search:** Implement `/search [query]` command. Query `gemini-2.5-flash` with Google Search Grounding tool enabled to answer real-time questions, returning search source URLs.
- [ ] **Vision Analysis:** Implement image upload listener. Handle incoming group photos using `gemini-3.5-flash` to describe or debug screenshots.

### Deliverables
- Spoken voice note answers in Telegram.
- Accurate search answers with clickable references.
- Visual description of group photos.

---

## Phase 5: Real-time WebApp Voice Call

Design and build the Telegram WebApp and WebSocket proxy so users can have low-latency voice conversations with the assistant.

### Tasks
- [ ] Design a simple, animated HTML/JS single page voice interface for the Telegram WebApp.
- [ ] Implement WebApp WebSocket client connection to the `gemini-3.1-flash-live-preview` model.
- [ ] Code WebSocket message handler in the WebApp to convert Blobs to text, parse `setupComplete`, send `clientContent` prompts, and handle streamed PCM audio chunks.
- [ ] Implement `/call` command in Telegram that returns a button to launch the WebApp inside Telegram.

### Deliverables
- A fully functional, interactive Telegram WebApp voice call interface.
- Low-latency real-time voice-to-voice conversation session with the bot.

---

## Phase 6: Quota Warning & Polish

Implement usage constraints monitoring, local timezone date formatting, and prompt styling.

### Tasks
- [ ] Verify D1 daily quota counting for each model.
- [ ] Trigger warning messages when a model reaches 90% of its quota limit.
- [ ] Refine Persian Solar Hijri (Shamsi) date conversions using `Intl.DateTimeFormat`.
- [ ] Format bot conversational responses to be friendly, casual, and supportive.

### Deliverables
- Production-ready group assistant bot with error logging and quota warning signals.
