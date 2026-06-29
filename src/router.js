import { TelegramClient } from './telegram.js';
import { DatabaseClient } from './db.js';
import { AIRouter } from './ai.js';
import { handleTasks } from './tasks.js';
import { handleReminderCommand, parseReminderTime, formatPersianDate } from './reminders.js';
import { pcmToWav } from './audio.js';

// Constant offset for Iran Time (UTC+3:30)
const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

export async function routeUpdate(update, env) {
    const db = env.DB;
    const token = env.TELEGRAM_BOT_TOKEN;
    const geminiKey = env.GEMINI_API_KEY;

    const tgClient = new TelegramClient(token);
    const dbClient = new DatabaseClient(db);
    const aiRouter = new AIRouter(db, env.AI, geminiKey);

    // ==========================================
    // 1. Direct Mode: Callbacks (Inline Buttons)
    // ==========================================
    if (update.callback_query) {
        await handleTasks(update, db, token);
        return;
    }

    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username;
    const botUsername = env.BOT_USERNAME || 'digibot'; // Fallback to 'digibot'

    // Determine if the bot is directly addressed
    const isPrivateChat = message.chat.type === 'private';
    const isMentioned = message.text && message.text.includes(`@${botUsername}`);
    const isReplyToBot = message.reply_to_message && message.reply_to_message.from.is_bot;
    const isAddressed = isPrivateChat || isMentioned || isReplyToBot;

    // ==========================================
    // 2. Direct Mode: Photo Upload (Vision)
    // ==========================================
    if (message.photo && isAddressed) {
        try {
            // Get the largest photo size
            const photos = message.photo;
            const largestPhoto = photos[photos.length - 1];
            const fileId = largestPhoto.file_id;

            // Send typing indicator
            await tgClient.request('sendChatAction', { chat_id: chatId, action: 'upload_document' });

            // 1. Get file path from Telegram
            const fileInfo = await tgClient.request('getFile', { file_id: fileId });
            const filePath = fileInfo.file_path;

            // 2. Download the binary file
            const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
            const fileResponse = await fetch(fileUrl);
            if (!fileResponse.ok) throw new Error("دانلود فایل از تلگرام شکست خورد.");
            
            const arrayBuffer = await fileResponse.arrayBuffer();
            
            // Convert ArrayBuffer to base64
            const uint8 = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
                binary += String.fromCharCode(uint8[i]);
            }
            const base64Image = btoa(binary);
            const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

            // 3. Call Gemini Vision
            const prompt = message.caption || "این تصویر را تحلیل کن.";
            const { text, modelId } = await aiRouter.generateVision(prompt, base64Image, mimeType);

            const footer = `\n\n🧠 <i>پاسخ داده شده توسط مدل: ${modelId.replace('models/', '')}</i>`;
            await tgClient.sendMessage(chatId, text + footer);

        } catch (err) {
            console.error("Vision processing error:", err);
            await tgClient.sendMessage(chatId, `❌ خطایی در پردازش عکس رخ داد: ${err.message}`);
        }
        return;
    }

    if (!message.text) return;
    const rawText = message.text.trim();

    // ==========================================
    // 3. Direct Mode: Command Parsing (Bypasses Brain)
    // ==========================================
    
    // Direct /start
    if (rawText.startsWith('/start')) {
        const welcomeText = `🤖 <b>سلام! من دستیار هوشمند گروه شما هستم.</b>\n\n` +
                            `فازهای ۱ تا ۴ با موفقیت روی سرور کلادفلر پیاده‌سازی شدند!\n\n` +
                            `📋 <b>مدیریت وظایف (تسک‌ها):</b>\n` +
                            `• <code>/tasks</code> - نمایش تسک‌های شما\n` +
                            `• <code>/tasks_all</code> - نمایش کل تسک‌های گروه\n` +
                            `• کلمه <code>done</code> یا <code>تمومه</code> جهت تکمیل تسک\n\n` +
                            `⏰ <b>یادآورها (زمان ایران):</b>\n` +
                            `• <code>/remind 10m متن</code> - ثبت یادآور نسبی\n\n` +
                            `🔍 <b>جستجوی وب (گوگل):</b>\n` +
                            `• <code>/search [موضوع]</code> - جستجوی زنده در وب\n\n` +
                            `🔊 <b>تبدیل متن به ویس (TTS):</b>\n` +
                            `• <code>/say [متن]</code> - خوانش صوتی متن توسط ربات\n\n` +
                            `💬 <b>چت هوشمند:</b>\n` +
                            `• ربات را تگ کنید یا ریپلای بزنید تا با هوش مصنوعی پاسخ دهد.`;
        await tgClient.sendMessage(chatId, welcomeText);
        return;
    }

    // Direct Tasks Commands
    if (rawText.startsWith('/tasks') || rawText.toLowerCase() === 'done' || rawText === 'تمومه' || rawText === 'تسک من تمومه') {
        await handleTasks(update, db, token);
        return;
    }

    // Direct Remind Command
    if (rawText.startsWith('/remind')) {
        await handleReminderCommand(update, db, token);
        return;
    }

    // Direct Search Command
    if (rawText.startsWith('/search ')) {
        const query = rawText.substring(8).trim();
        if (!query) {
            await tgClient.sendMessage(chatId, "⚠️ لطفاً موضوع جستجو را بنویسید.\nمثال: <code>/search قیمت دلار امروز</code>");
            return;
        }
        await handleDirectSearch(chatId, query, tgClient, aiRouter);
        return;
    }

    // Direct Say Command (TTS)
    if (rawText.startsWith('/say ')) {
        const speakText = rawText.substring(5).trim();
        if (!speakText) {
            await tgClient.sendMessage(chatId, "⚠️ لطفاً متنی برای خواندن بنویسید.\nمثال: <code>/say سلام مهران خوش آمدی</code>");
            return;
        }
        await handleDirectTts(chatId, speakText, tgClient, aiRouter);
        return;
    }

    // ==========================================
    // 4. Semantic Mode (Brain-Based Intent Routing)
    // ==========================================
    if (isAddressed) {
        // Clean up mention tag from text
        const cleanText = rawText.replace(new RegExp(`@${botUsername}`, 'g'), '').trim();
        if (!cleanText) return;

        // Send typing indicator
        await tgClient.request('sendChatAction', { chat_id: chatId, action: 'typing' });

        try {
            // Step A: Classify Intent using the Brain Router
            const intent = await aiRouter.classifyIntent(cleanText);

            // Step B: Dispatch to correct pipeline based on intent
            if (intent === 'SEARCH') {
                await handleDirectSearch(chatId, cleanText, tgClient, aiRouter);
            } 
            else if (intent === 'TTS') {
                await handleDirectTts(chatId, cleanText, tgClient, aiRouter);
            } 
            else if (intent === 'BULK_ACTION' && message.reply_to_message && message.reply_to_message.text) {
                // Bulk action works on the replied-to text list
                const listText = message.reply_to_message.text;
                await handleBulkAction(chatId, listText, message.from, tgClient, aiRouter, dbClient);
            } 
            else {
                // Default: CHAT conversation
                // For simplicity we pass the single prompt, but can be extended with history
                const { text, modelId } = await aiRouter.generateChat([
                    { role: 'user', content: cleanText }
                ]);
                const footer = `\n\n🧠 <i>مدل فعال: ${modelId.replace('models/', '')}</i>`;
                await tgClient.sendMessage(chatId, text + footer);
            }

        } catch (err) {
            console.error("Semantic routing error:", err);
            await tgClient.sendMessage(chatId, `❌ متاسفانه خطایی در پردازش رخ داد: ${err.message}`);
        }
    }
}

/**
 * Executes direct web search and posts results.
 */
async function handleDirectSearch(chatId, query, tgClient, aiRouter) {
    await tgClient.request('sendChatAction', { chat_id: chatId, action: 'typing' });
    
    const { text, metadata, modelId } = await aiRouter.generateSearch(query);
    
    let responseText = text;
    
    // Format grounding sources if available
    if (metadata && metadata.groundingChunks) {
        responseText += `\n\n🔗 <b>منابع وب:</b>\n`;
        const sources = metadata.groundingChunks;
        sources.forEach((src, idx) => {
            if (src.web) {
                // Shorten URL or show domain
                const domain = new URL(src.web.uri).hostname;
                responseText += `${idx + 1}. <a href="${src.web.uri}">${src.web.title || domain}</a>\n`;
            }
        });
    }

    responseText += `\n\n🔍 <i>جستجو شده توسط: ${modelId.replace('models/', '')}</i>`;
    await tgClient.sendMessage(chatId, responseText);
}

/**
 * Executes direct TTS and sends voice note.
 */
async function handleDirectTts(chatId, speakText, tgClient, aiRouter) {
    await tgClient.request('sendChatAction', { chat_id: chatId, action: 'record_voice' });

    const { audioBase64, mimeType, modelId } = await aiRouter.generateTts(speakText);

    // Convert Base64 back to binary Buffer
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Assemble WAV header
    const wavBuffer = pcmToWav(bytes.buffer, 24000, 1, 16);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });

    // Send voice to Telegram
    const caption = `🗣️ ویس خوانش متن با مدل: ${modelId.replace('models/', '')}`;
    await tgClient.sendVoice(chatId, blob, 'voice.wav', { caption });
}

/**
 * Parses and registers bulk tasks/reminders.
 */
async function handleBulkAction(chatId, bulkText, sender, tgClient, aiRouter, dbClient) {
    const { tasks = [], reminders = [] } = await aiRouter.parseBulkInput(bulkText);

    let countTasks = 0;
    let countReminders = 0;

    // 1. Save extracted tasks
    for (const t of tasks) {
        let assigneeUsername = t.assignee ? t.assignee.replace('@', '') : null;
        // If assignee matches the sender, bind Telegram ID
        let assigneeId = null;
        if (assigneeUsername && sender.username && assigneeUsername.toLowerCase() === sender.username.toLowerCase()) {
            assigneeId = sender.id;
        }

        const success = await dbClient.createTask(t.title, assigneeUsername, assigneeId, sender.username || sender.first_name);
        if (success) countTasks++;
    }

    // 2. Save extracted reminders
    for (const r of reminders) {
        // Parse the extracted relative/absolute time string
        const targetUtc = parseReminderTime(r.time);
        if (targetUtc) {
            const success = await dbClient.createReminder(chatId, sender.id, r.text, targetUtc.toISOString());
            if (success) countReminders++;
        }
    }

    let report = `✅ <b>پردازش دسته‌ای با موفقیت انجام شد:</b>\n\n`;
    if (countTasks > 0) report += `📋 تعداد <b>${countTasks} تسک</b> کاری ثبت شد.\n`;
    if (countReminders > 0) report += `⏰ تعداد <b>${countReminders} یادآور</b> هوشمند در دیتابیس ذخیره شد.\n`;
    
    if (countTasks === 0 && countReminders === 0) {
        report = `❌ هیچ تسک یا یادآور معتبری در متن لیست پیدا نشد.`;
    }

    await tgClient.sendMessage(chatId, report);
}
