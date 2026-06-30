import { TelegramClient } from './telegram.js';
import { DatabaseClient } from './db.js';
import { AIRouter } from './ai.js';
import { handleTasks } from './tasks.js';
import { handleReminderCommand, parseReminderTime, handleListReminders, formatPersianDate } from './reminders.js';
import { pcmToWav } from './audio.js';

// Constant offset for Iran Time (UTC+3:30)
const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

let cachedBotUsername = null;

/**
 * Dynamically fetches the bot's username from Telegram API and caches it.
 */
async function getBotUsername(tgClient) {
    if (cachedBotUsername) return cachedBotUsername;
    try {
        const me = await tgClient.request('getMe');
        cachedBotUsername = me.username;
        console.log(`Fetched and cached bot username: @${cachedBotUsername}`);
        return cachedBotUsername;
    } catch (err) {
        console.error("Failed to fetch bot username via getMe:", err);
        return null;
    }
}

/**
 * Helper to send a text reply and save it to D1 history.
 */
async function sendReplyText(chatId, replyToMessage, text, tgClient, dbClient, options = {}) {
    const replyOptions = {
        reply_parameters: {
            message_id: replyToMessage.message_id
        },
        ...options
    };
    const sentMsg = await tgClient.sendMessage(chatId, text, replyOptions);
    if (sentMsg) {
        await dbClient.saveMessageToHistory(
            sentMsg.message_id,
            chatId,
            sentMsg.from.id,
            sentMsg.from.username || sentMsg.from.first_name,
            text,
            replyToMessage.message_id
        );
    }
    return sentMsg;
}

/**
 * Helper to send a voice reply and save it to D1 history.
 */
async function sendReplyVoice(chatId, replyToMessage, voiceBlob, spokenText, tgClient, dbClient, options = {}) {
    const replyOptions = {
        reply_parameters: {
            message_id: replyToMessage.message_id
        },
        ...options
    };
    const sentMsg = await tgClient.sendVoice(chatId, voiceBlob, 'voice.wav', replyOptions);
    if (sentMsg) {
        await dbClient.saveMessageToHistory(
            sentMsg.message_id,
            chatId,
            sentMsg.from.id,
            sentMsg.from.username || sentMsg.from.first_name,
            `🗣️ [پیام صوتی]: ${spokenText}`,
            replyToMessage.message_id
        );
    }
    return sentMsg;
}

/**
 * Traces the message reply chain back up to 15 messages in the D1 database.
 * If there is a gap, it heals using Telegram's immediate reply payload.
 */
async function getReplyChain(chatId, startMessage, dbClient, maxDepth = 15) {
    const chain = [];
    let currentMsg = startMessage;
    let currentId = currentMsg.reply_to_message ? currentMsg.reply_to_message.message_id : null;

    for (let i = 0; i < maxDepth; i++) {
        if (!currentId) break;

        let parent = await dbClient.getMessageFromHistory(chatId, currentId);

        // If parent is missing in D1, check if we can heal it using Telegram's reply_to_message payload
        if (!parent && currentMsg.reply_to_message && currentMsg.reply_to_message.message_id === currentId) {
            const tMsg = currentMsg.reply_to_message;
            if (tMsg.text) {
                await dbClient.saveMessageToHistory(
                    tMsg.message_id,
                    chatId,
                    tMsg.from.id,
                    tMsg.from.username || tMsg.from.first_name,
                    tMsg.text,
                    tMsg.reply_to_message ? tMsg.reply_to_message.message_id : null
                );
                parent = {
                    message_id: tMsg.message_id,
                    user_id: tMsg.from.id,
                    username: tMsg.from.username || tMsg.from.first_name,
                    text: tMsg.text,
                    reply_to_message_id: tMsg.reply_to_message ? tMsg.reply_to_message.message_id : null
                };
            }
        }

        if (!parent) break;

        chain.unshift(parent);
        currentId = parent.reply_to_message_id;
        currentMsg = { reply_to_message: parent };
    }

    return chain;
}

export async function routeUpdate(update, env) {
    const db = env.DB;
    const token = env.TELEGRAM_BOT_TOKEN;
    const geminiKey = env.GEMINI_API_KEY;

    const tgClient = new TelegramClient(token);
    const dbClient = new DatabaseClient(db);
    const aiRouter = new AIRouter(db, env.AI, geminiKey);
    const botId = parseInt(token.split(':')[0], 10);
    
    // Fetch actual bot username dynamically
    const actualBotUsername = await getBotUsername(tgClient);
    const botUsername = actualBotUsername || env.BOT_USERNAME || 'digibot';

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

    // Update dynamic group members registry
    await dbClient.saveGroupMember(chatId, userId, username, message.from.first_name);

    // Determine if the bot is directly addressed
    const isPrivateChat = message.chat.type === 'private';
    const isMentioned = message.text && message.text.includes(`@${botUsername}`);
    const isReplyToBot = message.reply_to_message && message.reply_to_message.from.id === botId;
    const isAddressed = isPrivateChat || isMentioned || isReplyToBot;

    // Save incoming text message to history
    if (message.text) {
        await dbClient.saveMessageToHistory(
            message.message_id,
            chatId,
            userId,
            username || message.from.first_name,
            message.text.trim(),
            message.reply_to_message ? message.reply_to_message.message_id : null
        );
    }

    // ==========================================
    // 2. Direct Mode: Photo Upload (Vision)
    // ==========================================
    if (message.photo && isAddressed) {
        try {
            // Save incoming photo message as a text placeholder in D1 history
            await dbClient.saveMessageToHistory(
                message.message_id,
                chatId,
                userId,
                username || message.from.first_name,
                `[فرستادن تصویر: ${message.caption || 'بدون توضیح'}]`,
                message.reply_to_message ? message.reply_to_message.message_id : null
            );
            const photos = message.photo;
            const largestPhoto = photos[photos.length - 1];
            const fileId = largestPhoto.file_id;

            await tgClient.request('sendChatAction', { chat_id: chatId, action: 'upload_document' });

            const fileInfo = await tgClient.request('getFile', { file_id: fileId });
            const filePath = fileInfo.file_path;

            const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
            const fileResponse = await fetch(fileUrl);
            if (!fileResponse.ok) throw new Error("دانلود فایل از تلگرام شکست خورد.");
            
            const arrayBuffer = await fileResponse.arrayBuffer();
            
            const uint8 = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
                binary += String.fromCharCode(uint8[i]);
            }
            const base64Image = btoa(binary);
            const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

            const prompt = message.caption || "این تصویر را تحلیل کن.";
            const { text } = await aiRouter.generateVision(prompt, base64Image, mimeType);
            await sendReplyText(chatId, message, text, tgClient, dbClient);

        } catch (err) {
            console.error("Vision processing error:", err);
            await sendReplyText(chatId, message, `❌ خطایی در پردازش عکس رخ داد: ${err.message}`, tgClient, dbClient);
        }
        return;
    }

    if (!message.text) return;
    
    // Clean commands suffix for group chats (e.g. /search@botusername -> /search)
    let rawText = message.text.trim();
    if (botUsername) {
        rawText = rawText.replace(new RegExp(`^(/\\w+)@${botUsername}`, 'i'), '$1');
    }

    // ==========================================
    // 3. Direct Mode: Command Parsing (Bypasses Brain)
    // ==========================================
    
    // Direct /start
    if (rawText.startsWith('/start')) {
        const welcomeText = `🤖 <b>سلام! من دستیار هوشمند گروه شما (Digi-Bot) هستم.</b>\n\n` +
                            `من به شما در مدیریت وظایف (تسک‌ها)، یادآورها، جستجوی زنده وب، پاسخ‌های صوتی و تحلیل تصاویر کمک می‌کنم.\n\n` +
                            `ℹ️ برای مشاهده لیست کامل دستورات و راهنمای استفاده، دستور <code>/help</code> را ارسال کنید! 🌹`;
        await sendReplyText(chatId, message, welcomeText, tgClient, dbClient);
        return;
    }

    // Direct /reminds or /reminds_all
    if (rawText.startsWith('/reminds')) {
        await handleListReminders(update, db, token);
        return;
    }

    // Direct /help
    if (rawText.startsWith('/help')) {
        const helpText = `📋 <b>راهنمای کامل دستورات Digi-Bot:</b>\n\n` +
                         `📌 <b>مدیریت وظایف (تسک‌ها):</b>\n` +
                         `• <code>/tasks</code> - نمایش تسک‌های فعال شما\n` +
                         `• <code>/tasks_all</code> - نمایش کل تسک‌های فعال گروه به تفکیک افراد\n` +
                         `• نوشتن کلمه <code>done</code> یا <code>تمومه</code> جهت تیک زدن تسک فعلی\n\n` +
                         `⏰ <b>یادآورهای هوشمند (منطقه زمانی تهران):</b>\n` +
                         `• <code>/remind [زمان] [متن]</code> - ثبت یادآور جدید\n` +
                         `   مثال نسبی: <code>/remind 10m تماس با علی</code>\n` +
                         `   مثال ساعت مشخص: <code>/remind 18:30 جلسه هماهنگی</code>\n\n` +
                         `🔍 <b>جستجوی زنده در وب (گوگل):</b>\n` +
                         `• <code>/search [موضوع]</code> - سرچ زنده وب و دریافت پاسخ مستند با لینک منابع\n\n` +
                         `🔊 <b>تبدیل متن به ویس (TTS):</b>\n` +
                         `• <code>/say [متن]</code> - خوانش صوتی متن شما با ویس تلگرامی\n\n` +
                         `💬 <b>هوش مصنوعی و مغز ربات (تگ یا ریپلای):</b>\n` +
                         `• کافیست ربات را تگ کنید یا روی پیام ریپلای بزنید تا به شما پاسخ دهد.\n` +
                         `• <b>ثبت لیست دسته‌ای:</b> روی یک لیست متنی از تسک‌ها/یادآورها ریپلای بزنید و ربات را تگ کرده، بنویسید <i>«اینا رو ثبت کن»</i> تا همه را خودکار به دیتابیس ببرد.\n\n` +
                         `🖼️ <b>تحلیل تصاویر (بینایی ماشین):</b>\n` +
                         `• یک تصویر بفرستید و ربات را تگ کنید تا آن را تحلیل و بررسی کند.`;
        await sendReplyText(chatId, message, helpText, tgClient, dbClient);
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
            await sendReplyText(chatId, message, "⚠️ لطفاً موضوع جستجو را بنویسید.\nمثال: <code>/search قیمت دلار امروز</code>", tgClient, dbClient);
            return;
        }
        await handleDirectSearch(message, query, tgClient, aiRouter, dbClient);
        return;
    }

    // Direct Say Command (TTS)
    if (rawText.startsWith('/say ')) {
        const speakText = rawText.substring(5).trim();
        if (!speakText) {
            await sendReplyText(chatId, message, "⚠️ لطفاً متنی برای خواندن بنویسید.\nمثال: <code>/say سلام مهران خوش آمدی</code>", tgClient, dbClient);
            return;
        }
        await handleDirectTts(message, speakText, tgClient, aiRouter, dbClient);
        return;
    }

    // ==========================================
    // 4. Semantic Mode (Brain-Based Intent Routing)
    // ==========================================
    if (isAddressed) {
        const cleanText = rawText.replace(new RegExp(`@${botUsername}`, 'g'), '').trim();
        if (!cleanText) return;

        await tgClient.request('sendChatAction', { chat_id: chatId, action: 'typing' });

        try {
            const intent = await aiRouter.classifyIntent(cleanText);

            if (intent === 'SEARCH') {
                await handleDirectSearch(message, cleanText, tgClient, aiRouter, dbClient);
            } 
            else if (intent === 'TTS') {
                // Strip common Persian speech prefixes: e.g. "برام ویس بگیر بگو سلام" -> "سلام"
                const ttsClean = cleanText.replace(/^(برام\s+)?(ویس\s+بگیر|ویس\s+بفرست|بخون|بخوان|بگو|تلفظ\s+کن)\s+(بگو\s+)?/i, '').trim();
                await handleDirectTts(message, ttsClean || cleanText, tgClient, aiRouter, dbClient);
            } 
            else if (intent === 'DB_OPERATION') {
                const isReplyToOtherUser = message.reply_to_message && message.reply_to_message.from.id !== botId;
                const parseText = isReplyToOtherUser ? message.reply_to_message.text : cleanText;
                await handleDbOperation(message, parseText, tgClient, aiRouter, dbClient, message.from);
            } 
            else {
                // Default: CHAT conversation (with up to 15 replies context)
                const replyChain = await getReplyChain(chatId, message, dbClient, 15);
                
                // Format messages array with conversation history
                const messages = [];
                for (const msg of replyChain) {
                    const isBot = msg.user_id === botId;
                    messages.push({
                        role: isBot ? 'assistant' : 'user',
                        content: isBot ? msg.text : `${msg.username || 'user'}: ${msg.text}`
                    });
                }
                messages.push({
                    role: 'user',
                    content: message.from.username ? `@${message.from.username}: ${cleanText}` : `${message.from.first_name}: ${cleanText}`
                });

                const { text } = await aiRouter.generateChat(messages);
                await sendReplyText(chatId, message, text, tgClient, dbClient);
            }

        } catch (err) {
            console.error("Semantic routing error:", err);
            await sendReplyText(chatId, message, `❌ متاسفانه خطایی در پردازش رخ داد: ${err.message}`, tgClient, dbClient);
        }
    }
}

/**
 * Executes direct web search and posts results as a reply.
 */
async function handleDirectSearch(message, query, tgClient, aiRouter, dbClient) {
    const chatId = message.chat.id;
    await tgClient.request('sendChatAction', { chat_id: chatId, action: 'typing' });
    
    const { text, metadata, modelId } = await aiRouter.generateSearch(query);
    
    let responseText = text;
    
    if (metadata && metadata.groundingChunks) {
        responseText += `\n\n🔗 <b>منابع وب:</b>\n`;
        const sources = metadata.groundingChunks;
        sources.forEach((src, idx) => {
            if (src.web) {
                const domain = new URL(src.web.uri).hostname;
                responseText += `${idx + 1}. <a href="${src.web.uri}">${src.web.title || domain}</a>\n`;
            }
        });
    }

    await sendReplyText(chatId, message, responseText, tgClient, dbClient);
}

/**
 * Executes direct TTS and sends voice note.
 */
async function handleDirectTts(message, speakText, tgClient, aiRouter, dbClient) {
    const chatId = message.chat.id;
    await tgClient.request('sendChatAction', { chat_id: chatId, action: 'record_voice' });

    const { audioBase64, mimeType, modelId } = await aiRouter.generateTts(speakText);

    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    const wavBuffer = pcmToWav(bytes.buffer, 24000, 1, 16);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });

    await sendReplyVoice(chatId, message, blob, speakText, tgClient, dbClient);
}

/**
 * Parses and executes structured database operations (Add, Edit, Delete).
 */
/**
 * Parses and executes structured database operations (Add, Edit, Delete).
 * Injects active database context (tasks, reminders, group members) to improve LLM accuracy.
 */
async function handleDbOperation(message, parseText, tgClient, aiRouter, dbClient, sender) {
    const chatId = message.chat.id;

    // 1. Fetch current active state for context
    const activeTasks = await dbClient.getAllActiveTasks();
    const activeReminders = await dbClient.getAllPendingReminders(chatId);
    const members = await dbClient.getGroupMembers(chatId);

    // Get current Iranian calendar and time context
    const now = new Date();
    const iranNow = new Date(now.getTime() + IRAN_OFFSET_MS);
    const formattedIranNow = formatPersianDate(now);

    let dbContext = `Current Time Context:\n`;
    dbContext += `- Gregorian UTC Time: ${now.toISOString()}\n`;
    dbContext += `- Iran Local Time: ${formattedIranNow} (${iranNow.toISOString().replace('Z', '')} local)\n\n`;

    dbContext += "Active Tasks:\n";
    for (const t of activeTasks) {
        dbContext += `- ID ${t.id}: title "${t.title}", assignee username "${t.assigned_to_username || 'unassigned'}"\n`;
    }
    dbContext += "\nActive Pending Reminders in this Chat:\n";
    for (const r of activeReminders) {
        dbContext += `- ID ${r.id}: text "${r.text}", time "${r.remind_at}"\n`;
    }
    dbContext += "\nGroup Members in this Chat:\n";
    for (const m of members) {
        dbContext += `- Member: username "${m.username || 'none'}", first name "${m.first_name}", user ID ${m.user_id}\n`;
    }

    // 2. Parse operations using the database context
    const { operations = [] } = await aiRouter.parseDbOperation(parseText, dbContext);

    let report = `⚙️ <b>گزارش تغییرات پایگاه‌داده:</b>\n\n`;
    let countSuccess = 0;

    for (const op of operations) {
        try {
            // ==========================================
            // 1. ADD OPERATION
            // ==========================================
            if (op.action === 'ADD') {
                if (op.type === 'TASK') {
                    let assigneeUsername = op.assignee ? op.assignee.replace('@', '') : null;
                    let assigneeId = null;

                    // Resolve assignee from known group members registry (case-insensitive username or first name match)
                    if (assigneeUsername) {
                        const found = await dbClient.searchGroupMember(chatId, assigneeUsername);
                        if (found.length > 0) {
                            assigneeUsername = found[0].username;
                            assigneeId = found[0].user_id;
                        }
                    } else if (sender.username && assigneeUsername && assigneeUsername.toLowerCase() === sender.username.toLowerCase()) {
                        assigneeId = sender.id;
                    }

                    const success = await dbClient.createTask(op.title, assigneeUsername, assigneeId, sender.username || sender.first_name);
                    if (success) {
                        const assigneeText = assigneeUsername ? `@${assigneeUsername}` : 'تخصیص‌نیافته';
                        report += `➕ تسک <b>"${op.title}"</b> برای <b>${assigneeText}</b> ثبت شد.\n`;
                        countSuccess++;
                    }
                } 
                else if (op.type === 'REMINDER') {
                    const targetUtc = parseReminderTime(op.time);
                    if (targetUtc) {
                        const success = await dbClient.createReminder(chatId, sender.id, op.text, targetUtc.toISOString());
                        if (success) {
                            report += `➕ یادآور <b>"${op.text}"</b> برای ساعت <code>${op.time}</code> ثبت شد.\n`;
                            countSuccess++;
                        }
                    }
                }
            }
            // ==========================================
            // 2. DELETE OPERATION
            // ==========================================
            else if (op.action === 'DELETE') {
                if (op.type === 'TASK') {
                    const tasks = await dbClient.searchTasks(op.search_query);
                    if (tasks.length > 0) {
                        const target = tasks[0];
                        await dbClient.deleteTask(target.id);
                        report += `🗑️ تسک <b>"${target.title}"</b> حذف شد.\n`;
                        countSuccess++;
                    } else {
                        report += `❌ تسکی برای حذف با عبارت "${op.search_query}" پیدا نشد.\n`;
                    }
                } 
                else if (op.type === 'REMINDER') {
                    const reminders = await dbClient.searchReminders(chatId, op.search_query);
                    if (reminders.length > 0) {
                        const target = reminders[0];
                        await dbClient.deleteReminder(target.id);
                        report += `🗑️ یادآور <b>"${target.text}"</b> حذف شد.\n`;
                        countSuccess++;
                    } else {
                        report += `❌ یادآوری برای حذف با عبارت "${op.search_query}" پیدا نشد.\n`;
                    }
                }
            }
            // ==========================================
            // 3. EDIT OPERATION
            // ==========================================
            else if (op.action === 'EDIT') {
                if (op.type === 'TASK') {
                    const isAllQuery = op.search_query && (
                        op.search_query.includes('همه') || 
                        op.search_query.includes('all') || 
                        op.search_query.includes('کل')
                    );
                    
                    if (isAllQuery) {
                        let userTasks = await dbClient.getActiveTasksForUser(sender.id);
                        if (userTasks.length === 0 && sender.username) {
                            userTasks = await dbClient.getActiveTasksForUsername(sender.username);
                        }
                        
                        if (userTasks.length > 0) {
                            for (const t of userTasks) {
                                await dbClient.updateTask(t.id, op.title || null, null, null, op.status || null);
                            }
                            const statusText = op.status === 'done' ? 'انجام شده' : op.status || 'ویرایش شده';
                            report += `✏️ تعداد <b>${userTasks.length} تسک</b> شما به وضعیت <b>${statusText}</b> تغییر یافت.\n`;
                            countSuccess++;
                        } else {
                            report += `❌ هیچ تسک فعالی برای شما پیدا نشد.\n`;
                        }
                    } else {
                        const tasks = await dbClient.searchTasks(op.search_query);
                        if (tasks.length > 0) {
                            const target = tasks[0];
                            let assigneeUsername = op.assignee ? op.assignee.replace('@', '') : null;
                            let assigneeId = null;

                            if (assigneeUsername) {
                                const found = await dbClient.searchGroupMember(chatId, assigneeUsername);
                                if (found.length > 0) {
                                    assigneeUsername = found[0].username;
                                    assigneeId = found[0].user_id;
                                }
                            } else if (sender.username && assigneeUsername && assigneeUsername.toLowerCase() === sender.username.toLowerCase()) {
                                assigneeId = sender.id;
                            }

                            await dbClient.updateTask(target.id, op.title, assigneeUsername, assigneeId, op.status);
                            const statusText = op.status === 'done' ? 'انجام شده' : 'ویرایش شده';
                            report += `✏️ تسک <b>"${target.title}"</b> به وضعیت <b>${statusText}</b> تغییر یافت.\n`;
                            countSuccess++;
                        } else {
                            report += `❌ تسکی برای ویرایش با عبارت "${op.search_query}" پیدا نشد.\n`;
                        }
                    }
                } 
                else if (op.type === 'REMINDER') {
                    const reminders = await dbClient.searchReminders(chatId, op.search_query);
                    if (reminders.length > 0) {
                        const target = reminders[0];
                        const targetUtc = op.time ? parseReminderTime(op.time) : null;
                        await dbClient.updateReminder(target.id, op.text, targetUtc ? targetUtc.toISOString() : null);
                        report += `✏️ یادآور <b>"${target.text}"</b> با موفقیت ویرایش شد.\n`;
                        countSuccess++;
                    } else {
                        report += `❌ یادآوری برای ویرایش با عبارت "${op.search_query}" پیدا نشد.\n`;
                    }
                }
            }
        } catch (e) {
            console.error("Error processing operations:", e);
            report += `⚠️ خطا در اجرای عملیات روی "${op.title || op.text || op.search_query}": ${e.message}\n`;
        }
    }

    if (countSuccess === 0 && operations.length === 0) {
        report = `❌ هیچ درخواست تغییر یا ثبت دیتابیسی در پیام پیدا نشد.`;
    }

    await sendReplyText(chatId, message, report.trim(), tgClient, dbClient);
}
