import { Hono } from 'hono';
import { routeUpdate } from './router.js';
import { checkAndSendReminders } from './reminders.js';
import { checkAndSendDailyGames } from './games.js';
import { DatabaseClient } from './db.js';

const app = new Hono();

// Basic status check route
app.get('/', (c) => {
    return c.text('🤖 Digi-Bot Worker is running! Webhook and AI router are active.');
});

// Telegram webhook receiver
app.post('/webhook', async (c) => {
    try {
        const update = await c.req.json();
        
        // Dispatch to Direct / Semantic message router
        await routeUpdate(update, c.env);
        
        return c.json({ ok: true });
    } catch (err) {
        console.error("Critical error in /webhook handler:", err);
        return c.json({ ok: false, error: err.message }, 500);
    }
});

// Export Hono fetch handler alongside scheduled Cron Trigger handler
export default {
    fetch: app.fetch,
    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            // 1. Run background reminders check
            await checkAndSendReminders(env.DB, env.TELEGRAM_BOT_TOKEN);
            
            // 2. Run background daily games check (if group chat is registered)
            const dbClient = new DatabaseClient(env.DB);
            const activeGroupId = await dbClient.getGameSetting("active_group_chat_id");
            if (activeGroupId) {
                await checkAndSendDailyGames(env.DB, env.TELEGRAM_BOT_TOKEN, env.GEMINI_API_KEY, parseInt(activeGroupId, 10));
            }
        })());
    }
};
