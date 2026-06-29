import { DatabaseClient } from './db.js';
import { TelegramClient } from './telegram.js';

/**
 * Handles task-related Telegram commands and text messages.
 */
export async function handleTasks(update, db, tg) {
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(tg);

    // 1. Handle Inline Keyboard Callbacks (Toggling task done)
    if (update.callback_query) {
        const callbackQuery = update.callback_query;
        const data = callbackQuery.data;

        if (data.startsWith('complete_task:')) {
            const taskId = parseInt(data.split(':')[1], 10);
            const task = await dbClient.getTaskById(taskId);

            if (!task) {
                await tgClient.answerCallbackQuery(callbackQuery.id, 'تسک پیدا نشد!', true);
                return;
            }

            // Verify if the user clicking is the one assigned
            const userId = callbackQuery.from.id;
            const username = callbackQuery.from.username;

            if (task.assigned_to_id !== userId && task.assigned_to_username !== username) {
                await tgClient.answerCallbackQuery(callbackQuery.id, 'شما مجاز به ثبت انجام این تسک نیستید!', true);
                return;
            }

            await dbClient.completeTask(taskId);
            
            // Edit original message to remove buttons and show success
            await tgClient.editMessageText(
                callbackQuery.message.chat.id,
                callbackQuery.message.message_id,
                `✅ تسک <b>"${task.title}"</b> با موفقیت انجام شد! 🎉`
            );
            
            await tgClient.answerCallbackQuery(callbackQuery.id, 'تسک انجام شد!');
        }
        return;
    }

    const message = update.message;
    if (!message || !message.text) return;

    const text = message.text.trim();
    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username;

    // Helper: format user display name
    const getUserDisplay = (from) => {
        return from.username ? `@${from.username}` : (from.first_name || 'کاربر');
    };

    // ==========================================
    // 1. COMMAND: /tasks (List user's active tasks)
    // ==========================================
    if (text.startsWith('/tasks') && !text.startsWith('/tasks_all')) {
        let tasks = [];
        if (userId) {
            tasks = await dbClient.getActiveTasksForUser(userId);
        }
        if (tasks.length === 0 && username) {
            tasks = await dbClient.getActiveTasksForUsername(username);
        }

        if (tasks.length === 0) {
            await tgClient.sendMessage(chatId, `❌ ${getUserDisplay(message.from)} شما هیچ تسک فعالی ندارید.`);
            return;
        }

        let responseText = `📋 <b>تسک‌های فعال شما:</b>\n\n`;
        tasks.forEach((t, index) => {
            responseText += `${index + 1}. 📌 ${t.title}\n`;
        });
        await tgClient.sendMessage(chatId, responseText);
        return;
    }

    // ==========================================
    // 2. COMMAND: /tasks_all (List everyone's active tasks)
    // ==========================================
    if (text.startsWith('/tasks_all')) {
        const allTasks = await dbClient.getAllActiveTasks();

        if (allTasks.length === 0) {
            await tgClient.sendMessage(chatId, `❌ هیچ تسک فعالی در گروه وجود ندارد.`);
            return;
        }

        // Group tasks by assignee
        const grouped = {};
        allTasks.forEach(t => {
            const assignee = t.assigned_to_username ? `@${t.assigned_to_username}` : 'بدون مسئول';
            if (!grouped[assignee]) grouped[assignee] = [];
            grouped[assignee].push(t);
        });

        let responseText = `👥 <b>لیست تسک‌های فعال گروه:</b>\n\n`;
        for (const [assignee, tasks] of Object.entries(grouped)) {
            responseText += `👤 <b>${assignee}:</b>\n`;
            tasks.forEach((t) => {
                responseText += `   • 📌 ${t.title}\n`;
            });
            responseText += `\n`;
        }
        await tgClient.sendMessage(chatId, responseText.trim());
        return;
    }

    // ==========================================
    // 3. TEXT TRIGGERS: "done" or "تمومه" (Smart Task Completion)
    // ==========================================
    const isDoneRequest = text.toLowerCase() === 'done' || text === 'تمومه' || text === 'تسک من تمومه';
    if (isDoneRequest) {
        let tasks = [];
        if (userId) {
            tasks = await dbClient.getActiveTasksForUser(userId);
        }
        if (tasks.length === 0 && username) {
            tasks = await dbClient.getActiveTasksForUsername(username);
        }

        if (tasks.length === 0) {
            await tgClient.sendMessage(chatId, `❌ ${getUserDisplay(message.from)} شما تسک فعال ثبت‌شده‌ای ندارید.`);
            return;
        }

        // Case A: Exactly 1 active task -> Complete it directly
        if (tasks.length === 1) {
            const task = tasks[0];
            await dbClient.completeTask(task.id);
            await tgClient.sendMessage(chatId, `✅ تسک <b>"${task.title}"</b> با موفقیت انجام شد! 🎉`);
            return;
        }

        // Case B: Multiple active tasks -> Show Inline Buttons
        const inlineKeyboard = tasks.map(t => [
            {
                text: t.title,
                callback_data: `complete_task:${t.id}`
            }
        ]);

        await tgClient.sendMessage(chatId, `🤔 ${getUserDisplay(message.from)} شما چند تسک فعال دارید. کدام‌یک را تموم کردید؟`, {
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
        return;
    }
}
