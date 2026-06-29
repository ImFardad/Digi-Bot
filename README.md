# Digi-Bot Assistant

Digi-Bot is a highly capable, serverless Telegram group assistant designed for work groups. It is built using **JavaScript (ES Modules)** and runs on **Cloudflare Workers** using the **Hono** framework and **Cloudflare D1** SQLite database.

---

## 🌟 Key Features

- **Direct & Semantic Routing:** Instantly dispatches Telegram commands, while using a semantic Llama-3 "Brain" (with Gemma fallback) to route natural language mentions or replies to appropriate AI tools.
- **Smart Task Management:** Track tasks directly in the group (`/tasks`, `/tasks_all`). Complete tasks natively via interactive Telegram inline keyboards.
- **Smart Reminders:** Local fast regex parser for direct reminder commands (e.g. `/remind 10m meeting`), with background cron triggers scanning D1 every minute to send reminders to the group.
- **Google Search Grounding:** Perform live web search using Gemini 2.5 Flash to answer real-time questions (1,500 requests/day).
- **Text-To-Speech (TTS):** Spoken audio note responses via the `/say [text]` command.
- **Telegram WebApp Live Call:** Click `/call` to start a real-time, low-latency, voice-to-voice conversation session powered by the Gemini Live API (`gemini-3.1-flash-live-preview` over WebSockets).
- **Timezone & Calendar Sync:** Synchronized with Iran's timezone (`Asia/Tehran`) and featuring native Solar Hijri (Shamsi) calendar output.
- **Quota Tracking:** Real-time logging of daily model requests to D1, with automatic group alerts and dynamic model switching when approaching limits.

---

## 📂 Project Structure

```
├── docs/
│   ├── bot_plan.md          # Complete bot architecture and specifications
│   ├── api_usage.md         # API payloads, WebSockets, and PCM-to-WAV code
│   └── deployment_guide.md  # Deployment instructions for Cloudflare Workers
├── src/
│   ├── index.js             # Hono app entry point (Webhook handler)
│   ├── router.js            # Direct and semantic command routing
│   ├── db.js                # D1 database helpers (Tasks, reminders, API logs)
│   ├── tasks.js             # Telegram tasks command logic & Inline Keyboards
│   ├── reminders.js         # Reminder parsing, database insertion, and cron alerts
│   ├── ai.js                # AI client wrapper and model fallback chains
│   └── audio.js             # PCM-to-WAV audio conversion logic
├── schema.sql               # SQLite database D1 migration file
├── wrangler.toml            # Cloudflare Workers deployment config
└── package.json             # NPM dependencies
```

---

## 🚀 Getting Started

Please see the [Deployment Guide](docs/deployment_guide.md) to set up and deploy Digi-Bot on Cloudflare Workers.
