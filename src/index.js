import { Hono } from 'hono';
import { handleTasks } from './tasks.js';
import { handleReminderCommand, checkAndSendReminders } from './reminders.js';
import { TelegramClient } from './telegram.js';

const app = new Hono();

// Basic health check route
app.get('/', (c) => {
    return c.text('🤖 Digi-Bot Worker is running! Webhook is active.');
});

// Telegram webhook receiver
app.post('/webhook', async (c) => {
    try {
        const update = await c.req.json();
        console.log("Received Telegram update:", JSON.stringify(update));

        const db = c.env.DB;
        const token = c.env.TELEGRAM_BOT_TOKEN;
        const tgClient = new TelegramClient(token);

        // 1. Handle Inline Keyboards and Callbacks
        if (update.callback_query) {
            await handleTasks(update, db, token);
            return c.json({ ok: true });
        }

        const message = update.message;
        if (!message || !message.text) {
            // Ignore non-text messages for Phase 1 & 2 (like stickers, audio, etc.)
            return c.json({ ok: true });
        }

        const text = message.text.trim();
        const chatId = message.chat.id;

        // 2. Dispatch to Task Handler
        const isTaskCommand = text.startsWith('/tasks') || 
                              text.toLowerCase() === 'done' || 
                              text === 'تمومه' || 
                              text === 'تسک من تمومه';
        
        if (isTaskCommand) {
            await handleTasks(update, db, token);
            return c.json({ ok: true });
        }

        // 3. Dispatch to Reminder Handler
        if (text.startsWith('/remind')) {
            await handleReminderCommand(update, db, token);
            return c.json({ ok: true });
        }

        // 4. Default handler for other text messages (Phase 1 & 2 placeholder)
        if (text.startsWith('/start')) {
            const welcomeText = `🤖 <b>سلام! من ربات دستیار گروه (Digi-Bot) هستم.</b>\n\n` +
                                `فاز ۱ (راه‌اندازی بیسیک و وب‌هوک) و فاز ۲ (مدیریت وظایف و یادآورها) با موفقیت روی سرور کلادفلر پیاده‌سازی شدند!\n\n` +
                                `📋 <b>دستورات تسک کاری:</b>\n` +
                                `• <code>/tasks</code> - نمایش تسک‌های فعال شما\n` +
                                `• <code>/tasks_all</code> - نمایش کل تسک‌های فعال گروه\n` +
                                `• نوشتن کلمه <code>done</code> یا <code>تمومه</code> جهت تکمیل خودکار تسک‌ها\n\n` +
                                `⏰ <b>یادآورهای هوشمند (منطقه زمانی تهران):</b>\n` +
                                `• <code>/remind 10m متن یادآور</code> - یادآوری نسبی بر اساس دقیقه (m)، ساعت (h) یا روز (d)\n` +
                                `• <code>/remind 18:30 متن یادآور</code> - یادآوری در ساعت مشخصِ امروز (یا فردا)`;
            await tgClient.sendMessage(chatId, welcomeText);
            return c.json({ ok: true });
        }

        // Catch-all response for unhandled commands (while AI is not yet active)
        if (text.startsWith('/')) {
            await tgClient.sendMessage(chatId, "⚠️ دستور ناشناخته. برای راهنمایی دستور <code>/start</code> را ارسال کنید.");
            return c.json({ ok: true });
        }

        // Silent ignore for general chat messages (will be handled by AI router in Phase 3)
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
        // Runs background check for reminders every minute
        ctx.waitUntil(checkAndSendReminders(env.DB, env.TELEGRAM_BOT_TOKEN));
    }
};
