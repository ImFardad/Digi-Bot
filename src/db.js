/**
 * Helper client to interact with the Cloudflare D1 SQLite Database.
 */
export class DatabaseClient {
    constructor(db) {
        if (!db) {
            throw new Error("D1 Database binding is missing.");
        }
        this.db = db;
    }

    // ==========================================
    // TASK METHODS
    // ==========================================

    async createTask(title, assignedToUsername, assignedToId, createdBy) {
        const query = `
            INSERT INTO tasks (title, assigned_to_username, assigned_to_id, created_by)
            VALUES (?, ?, ?, ?)
        `;
        const result = await this.db.prepare(query)
            .bind(title, assignedToUsername || null, assignedToId || null, createdBy || null)
            .run();
        return result.success;
    }

    async getActiveTasksForUser(userId) {
        const query = `
            SELECT * FROM tasks
            WHERE assigned_to_id = ? AND status = 'todo'
            ORDER BY created_at ASC
        `;
        const { results } = await this.db.prepare(query)
            .bind(userId)
            .all();
        return results;
    }

    async getActiveTasksForUsername(username) {
        const query = `
            SELECT * FROM tasks
            WHERE assigned_to_username = ? AND status = 'todo'
            ORDER BY created_at ASC
        `;
        const { results } = await this.db.prepare(query)
            .bind(username.replace('@', ''))
            .all();
        return results;
    }

    async getAllActiveTasks() {
        const query = `
            SELECT * FROM tasks
            WHERE status = 'todo'
            ORDER BY assigned_to_username ASC, created_at ASC
        `;
        const { results } = await this.db.prepare(query).all();
        return results;
    }

    async getTaskById(taskId) {
        const query = `SELECT * FROM tasks WHERE id = ?`;
        return this.db.prepare(query).bind(taskId).first();
    }

    async completeTask(taskId) {
        const query = `
            UPDATE tasks
            SET status = 'done'
            WHERE id = ?
        `;
        const result = await this.db.prepare(query).bind(taskId).run();
        return result.success;
    }

    // ==========================================
    // REMINDER METHODS
    // ==========================================

    async createReminder(chatId, userId, text, remindAtIsoString) {
        const query = `
            INSERT INTO reminders (chat_id, user_id, text, remind_at, is_sent)
            VALUES (?, ?, ?, ?, 0)
        `;
        const result = await this.db.prepare(query)
            .bind(chatId, userId, text, remindAtIsoString)
            .run();
        return result.success;
    }

    async getPendingReminders() {
        // Find reminders where remind_at is in the past (less than or equal to current time) and is_sent = 0
        const now = new Date().toISOString();
        const query = `
            SELECT * FROM reminders
            WHERE remind_at <= ? AND is_sent = 0
        `;
        const { results } = await this.db.prepare(query).bind(now).all();
        return results;
    }

    async markReminderAsSent(reminderId) {
        const query = `
            UPDATE reminders
            SET is_sent = 1
            WHERE id = ?
        `;
        const result = await this.db.prepare(query).bind(reminderId).run();
        return result.success;
    }

    // ==========================================
    // QUOTA & LOGGING METHODS
    // ==========================================

    async incrementQuota(modelName) {
        const today = new Date().toISOString().split('T')[0];
        
        // Upsert daily count
        const query = `
            INSERT INTO quota_usage (model_name, daily_count, last_reset_date)
            VALUES (?, 1, ?)
            ON CONFLICT(model_name) DO UPDATE SET
                daily_count = CASE 
                    WHEN last_reset_date = excluded.last_reset_date THEN daily_count + 1 
                    ELSE 1 
                END,
                last_reset_date = excluded.last_reset_date
        `;
        const result = await this.db.prepare(query).bind(modelName, today).run();
        return result.success;
    }

    async getQuotaUsage() {
        const today = new Date().toISOString().split('T')[0];
        const query = `
            SELECT * FROM quota_usage 
            WHERE last_reset_date = ?
        `;
        const { results } = await this.db.prepare(query).bind(today).all();
        return results;
    }

    // ==========================================
    // MESSAGE HISTORY FOR REPLY CHAINS
    // ==========================================

    async saveMessageToHistory(messageId, chatId, userId, username, text, replyToMessageId) {
        const query = `
            INSERT INTO message_history (message_id, chat_id, user_id, username, text, reply_to_message_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(message_id, chat_id) DO UPDATE SET
                text = excluded.text,
                reply_to_message_id = excluded.reply_to_message_id
        `;
        const result = await this.db.prepare(query)
            .bind(messageId, chatId, userId, username || null, text, replyToMessageId || null)
            .run();
        return result.success;
    }

    async getMessageFromHistory(chatId, messageId) {
        const query = `
            SELECT * FROM message_history
            WHERE chat_id = ? AND message_id = ?
        `;
        return this.db.prepare(query).bind(chatId, messageId).first();
    }

    // ==========================================
    // DB MANAGEMENT / EDIT & DELETE OPERATIONS
    // ==========================================

    async searchReminders(chatId, queryText) {
        const query = `
            SELECT * FROM reminders
            WHERE chat_id = ? AND is_sent = 0 AND text LIKE ?
            ORDER BY remind_at ASC
        `;
        const { results } = await this.db.prepare(query)
            .bind(chatId, `%${queryText}%`)
            .all();
        return results;
    }

    async deleteReminder(reminderId) {
        const query = `DELETE FROM reminders WHERE id = ?`;
        const result = await this.db.prepare(query).bind(reminderId).run();
        return result.success;
    }

    async updateReminder(reminderId, text, remindAt) {
        const query = `
            UPDATE reminders
            SET text = COALESCE(?, text),
                remind_at = COALESCE(?, remind_at)
            WHERE id = ?
        `;
        const result = await this.db.prepare(query).bind(text || null, remindAt || null, reminderId).run();
        return result.success;
    }

    async searchTasks(queryText) {
        const query = `
            SELECT * FROM tasks
            WHERE status = 'todo' AND title LIKE ?
            ORDER BY created_at ASC
        `;
        const { results } = await this.db.prepare(query)
            .bind(`%${queryText}%`)
            .all();
        return results;
    }

    async deleteTask(taskId) {
        const query = `DELETE FROM tasks WHERE id = ?`;
        const result = await this.db.prepare(query).bind(taskId).run();
        return result.success;
    }

    async updateTask(taskId, title, assigneeUsername, assigneeId, status) {
        const query = `
            UPDATE tasks
            SET title = COALESCE(?, title),
                assigned_to_username = COALESCE(?, assigned_to_username),
                assigned_to_id = COALESCE(?, assigned_to_id),
                status = COALESCE(?, status)
            WHERE id = ?
        `;
        const result = await this.db.prepare(query)
            .bind(title || null, assigneeUsername || null, assigneeId || null, status || null, taskId)
            .run();
        return result.success;
    }
}
