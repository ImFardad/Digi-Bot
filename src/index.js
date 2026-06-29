import { Hono } from 'hono';
import { routeUpdate } from './router.js';
import { checkAndSendReminders } from './reminders.js';

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

// Export Hono fetch handler alongside scheduled Cron Trigger handler for reminders
export default {
    fetch: app.fetch,
    async scheduled(event, env, ctx) {
        // Runs background check for reminders every minute
        ctx.waitUntil(checkAndSendReminders(env.DB, env.TELEGRAM_BOT_TOKEN));
    }
};
