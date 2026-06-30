import { DatabaseClient } from './db.js';
import { TelegramClient } from './telegram.js';

// Iran Time Offset: Constant UTC+3:30
const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

/**
 * Helper to get the current date-time object in Iran Time.
 */
function getIranNow() {
    const utcNow = new Date();
    return new Date(utcNow.getTime() + IRAN_OFFSET_MS);
}

/**
 * Converts a Date object representing Iran Time back to a UTC Date object.
 */
function iranToUtc(iranDate) {
    return new Date(iranDate.getTime() - IRAN_OFFSET_MS);
}

/**
 * Formats a Date object in Persian Solar Hijri (Shamsi) format.
 */
export function formatPersianDate(date) {
    // Modern JavaScript has built-in Solar Hijri calendar support!
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        dateStyle: 'full',
        timeStyle: 'medium',
        timeZone: 'Asia/Tehran'
    }).format(date);
}

/**
 * Parses a simple reminder time string and returns a UTC Date object.
 * Supports:
 * - Relative time: e.g. "10m" (10 mins), "2h" (2 hours), "1d" (1 day)
 * - Absolute time: e.g. "15:30" (schedules for today or tomorrow if past)
 */
export function parseReminderTime(timeStr) {
    const relativeRegex = /^(\d+)([mhd])$/i;
    const absoluteRegex = /^(\d{1,2}):(\d{2})$/;

    const iranNow = getIranNow();

    // 1. Match Relative Time (e.g., 10m, 2h, 1d)
    const relativeMatch = timeStr.match(relativeRegex);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2].toLowerCase();

        const targetIranDate = new Date(iranNow.getTime());
        if (unit === 'm') {
            targetIranDate.setMinutes(targetIranDate.getMinutes() + amount);
        } else if (unit === 'h') {
            targetIranDate.setHours(targetIranDate.getHours() + amount);
        } else if (unit === 'd') {
            targetIranDate.setDate(targetIranDate.getDate() + amount);
        }

        return iranToUtc(targetIranDate);
    }

    // 2. Match Absolute Time (e.g., 15:30)
    const absoluteMatch = timeStr.match(absoluteRegex);
    if (absoluteMatch) {
        const hours = parseInt(absoluteMatch[1], 10);
        const minutes = parseInt(absoluteMatch[2], 10);

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            throw new Error("ساعت نامعتبر است. باید بین 00:00 تا 23:59 باشد.");
        }

        const targetIranDate = new Date(iranNow.getTime());
        targetIranDate.setHours(hours, minutes, 0, 0);

        // If the target time is in the past today, schedule it for tomorrow
        if (targetIranDate.getTime() <= iranNow.getTime()) {
            targetIranDate.setDate(targetIranDate.getDate() + 1);
        }

        return iranToUtc(targetIranDate);
    }

    return null;
}

/**
 * Handles incoming Telegram /remind command.
 */
export async function handleReminderCommand(update, db, tg) {
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(tg);

    const message = update.message;
    if (!message || !message.text) return;

    const text = message.text.trim();
    const chatId = message.chat.id;
    const userId = message.from.id;

    if (!text.startsWith('/remind ')) {
        await tgClient.sendMessage(chatId, "⚠️ نحوه استفاده:\n<code>/remind [زمان] [متن یادآور]</code>\nمثال:\n<code>/remind 10m تماس با علی</code>\n<code>/remind 18:30 جلسه هماهنگی</code>");
        return;
    }

    // Split text into command parts: /remind [time] [reminder body]
    const parts = text.substring(8).trim().split(/\s+/);
    const timeArg = parts[0];
    const reminderText = parts.slice(1).join(' ');

    if (!timeArg || !reminderText) {
        await tgClient.sendMessage(chatId, "⚠️ لطفاً زمان و متن یادآوری را وارد کنید.\nمثال: <code>/remind 15m ارسال فاکتور</code>");
        return;
    }

    try {
        const targetUtcDate = parseReminderTime(timeArg);

        if (!targetUtcDate) {
            await tgClient.sendMessage(chatId, "❌ فرمت زمان نامعتبر است. فرمت‌های پشتیبانی شده: <code>10m</code>, <code>2h</code>, <code>1d</code> یا ساعت مشخص مانند <code>15:30</code>");
            return;
        }

        await dbClient.createReminder(chatId, userId, reminderText, targetUtcDate.toISOString());

        // Format target time to Solar Hijri for confirmation message
        const formattedDate = formatPersianDate(targetUtcDate);
        await tgClient.sendMessage(chatId, `✅ یادآور با موفقیت برای تاریخ زیر تنظیم شد:\n📅 <b>${formattedDate}</b>`);

    } catch (err) {
        await tgClient.sendMessage(chatId, `❌ خطا: ${err.message}`);
    }
}

/**
 * Cron trigger job checking for pending reminders and sending them to Telegram.
 */
export async function checkAndSendReminders(db, tg) {
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(tg);

    console.log("Running background reminder checks...");
    const pending = await dbClient.getPendingReminders();
    console.log(`Found ${pending.length} pending reminders due to be sent.`);

    for (const rem of pending) {
        try {
            // Mention user: we can build an HTML mention link if Telegram ID is available
            const mentionHtml = `<a href="tg://user?id=${rem.user_id}">یادآور</a>`;
            const alertText = `🔔 ${mentionHtml} <b>عزیز:</b>\n\n📌 ${rem.text}`;
            
            await tgClient.sendMessage(rem.chat_id, alertText);
            await dbClient.markReminderAsSent(rem.id);
            console.log(`Successfully sent reminder ID ${rem.id} to chat ${rem.chat_id}`);
        } catch (err) {
            console.error(`Failed to send reminder ID ${rem.id}:`, err);
        }
    }
}
