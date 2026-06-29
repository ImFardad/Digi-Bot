# Digi-Bot: Cloudflare Dashboard Deployment Guide (Zero-CLI Workflow)

This guide explains how to deploy Digi-Bot to Cloudflare using the **Cloudflare Dashboard (Browser-only)** and **Git Integration**, requiring no terminal commands on your local system for deployment.

---

## 1. Push to GitHub
Simply push this project to your GitHub repository:
`https://github.com/ImFardad/Digi-Bot`

Every time you push code to the `main` branch, Cloudflare will automatically build and deploy it.

---

## 2. Connect GitHub to Cloudflare Workers

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** -> **Create Application**.
3. Go to the **Pages** tab and click **Connect to Git**.
4. Select your GitHub account and choose the `Digi-Bot` repository.
5. In the Build settings:
   - **Framework preset:** None / Custom.
   - **Build command:** `npx wrangler deploy --dry-run` or leave empty (Pages handles Hono projects automatically).
   - **Root directory:** `/`.
6. Click **Save and Deploy**. Your worker code is now automatically deploying from Git!

---

## 3. Create and Bind the D1 SQLite Database

Cloudflare does not automatically create databases from Git, so we configure it once in the dashboard:

### A. Create the D1 Database
1. In the Cloudflare Dashboard, go to **Workers & Pages** -> **D1 (SQL Database)**.
2. Click **Create Database** -> **Dashboard**.
3. Name your database: `digi-bot-db`.
4. Click **Create**.
5. Once created, copy the **Database ID** (a long string of characters).

### B. Run the Schema SQL
1. Open the newly created `digi-bot-db` in the D1 panel.
2. Go to the **Console** tab.
3. Open the `schema.sql` file in this repository, copy its entire contents, paste it into the console, and click **Execute**. This creates the `tasks`, `reminders`, and `quota_usage` tables.

### C. Bind D1 to your Worker
1. Go back to **Workers & Pages** -> select your deployed `digi-bot` Page/Worker.
2. Go to the **Settings** tab -> **Functions** (or **Bindings**).
3. Scroll down to **D1 Database Bindings** and click **Add binding**.
4. Configure the binding:
   - **Variable name:** `DB` (Must be capitalized `DB` so the code can access it).
   - **D1 database:** Select `digi-bot-db`.
5. Click **Save**.

---

## 4. Bind Cloudflare Workers AI

Our Brain Router uses Cloudflare Workers AI. We must bind it in the settings:
1. Under your worker's **Settings** -> **Bindings** (or **Functions**).
2. Scroll to **AI Bindings** (or **Environment Variables** depending on worker type) and click **Add binding**.
   - **Variable name:** `AI`.
3. Click **Save**.

---

## 5. Configure API Keys (Environment Variables)

To allow the bot to communicate with Telegram and Google AI Studio:
1. In your worker's panel, go to the **Settings** tab -> **Variables** (or **Environment Variables**).
2. Click **Add Variable** (or **Edit Variables** -> **Add**) and add the following:
   - **Name:** `TELEGRAM_BOT_TOKEN` | **Value:** *Your Telegram Token from BotFather*
   - **Name:** `GEMINI_API_KEY` | **Value:** *Your Google AI Studio API Key*
3. Click **Save and Deploy**.

---

## 6. Register the Telegram Webhook

Telegram needs to know your deployed worker's address.
1. Copy your deployed worker's URL from the Cloudflare Dashboard (e.g., `https://digi-bot.pages.dev`).
2. Open your web browser and navigate to this URL (replace tokens/URLs with your own):
   ```
   https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_DEPLOYED_URL>/webhook
   ```
3. The page will return a JSON response confirming successful registration:
   `{"ok":true,"result":true,"description":"Webhook was set"}`
