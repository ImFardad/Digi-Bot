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
            WHERE assigned_to_username = ? COLLATE NOCASE AND status = 'todo'
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

    async getAllPendingReminders(chatId) {
        const query = `
            SELECT * FROM reminders
            WHERE chat_id = ? AND is_sent = 0
            ORDER BY remind_at ASC
        `;
        const { results } = await this.db.prepare(query).bind(chatId).all();
        return results;
    }

    // ==========================================
    // GROUP MEMBERS METHODS
    // ==========================================

    async saveGroupMember(chatId, userId, username, firstName) {
        const query = `
            INSERT INTO group_members (chat_id, user_id, username, first_name, last_seen)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(chat_id, user_id) DO UPDATE SET
                username = COALESCE(excluded.username, username),
                first_name = excluded.first_name,
                last_seen = CURRENT_TIMESTAMP
        `;
        const result = await this.db.prepare(query)
            .bind(chatId, userId, username || null, firstName)
            .run();
        return result.success;
    }

    async getGroupMembers(chatId) {
        const query = `
            SELECT * FROM group_members
            WHERE chat_id = ?
            ORDER BY last_seen DESC
        `;
        const { results } = await this.db.prepare(query).bind(chatId).all();
        return results;
    }

    async searchGroupMember(chatId, queryText) {
        const cleanQuery = queryText.replace('@', '').trim();
        const query = `
            SELECT * FROM group_members
            WHERE chat_id = ? AND (
                username LIKE ? COLLATE NOCASE OR
                first_name LIKE ? COLLATE NOCASE
            )
            ORDER BY last_seen DESC
        `;
        const { results } = await this.db.prepare(query)
            .bind(chatId, `%${cleanQuery}%`, `%${cleanQuery}%`)
            .all();
        return results;
    }

    // ==========================================
    // GAME MODULE METHODS
    // ==========================================

    async getGameSetting(key) {
        const query = `SELECT value FROM game_settings WHERE key = ?`;
        const row = await this.db.prepare(query).bind(key).first();
        return row ? row.value : null;
    }

    async setGameSetting(key, value) {
        const query = `
            INSERT INTO game_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `;
        const result = await this.db.prepare(query).bind(key, String(value)).run();
        return result.success;
    }

    async getUnusedQuizzes(limit = 14) {
        const query = `SELECT * FROM quiz_pool WHERE is_used = 0 ORDER BY id ASC LIMIT ?`;
        const { results } = await this.db.prepare(query).bind(limit).all();
        return results;
    }

    async getRecentQuizzes(limit = 14) {
        const query = `SELECT * FROM quiz_pool ORDER BY id DESC LIMIT ?`;
        const { results } = await this.db.prepare(query).bind(limit).all();
        return results;
    }

    async saveQuizQuestion(question, optionsJson, correctIndex) {
        const query = `
            INSERT INTO quiz_pool (question, options, correct_index)
            VALUES (?, ?, ?)
        `;
        const result = await this.db.prepare(query).bind(question, optionsJson, correctIndex).run();
        return result.success;
    }

    async markQuizAsSent(quizId) {
        const query = `UPDATE quiz_pool SET is_used = 1, sent_at = CURRENT_TIMESTAMP WHERE id = ?`;
        const result = await this.db.prepare(query).bind(quizId).run();
        return result.success;
    }

    async getActiveQuiz() {
        const query = `
            SELECT * FROM quiz_pool 
            WHERE is_used = 1 AND is_answered = 0 
            ORDER BY sent_at DESC LIMIT 1
        `;
        return this.db.prepare(query).first();
    }

    async resolveQuiz(quizId, winnerId, winnerUsername) {
        const query = `
            UPDATE quiz_pool 
            SET is_answered = 1, winner_id = ?, winner_username = ? 
            WHERE id = ?
        `;
        const result = await this.db.prepare(query).bind(winnerId, winnerUsername || null, quizId).run();
        return result.success;
    }

    async getUnusedGuesses(limit = 14) {
        const query = `SELECT * FROM guess_pool WHERE is_used = 0 ORDER BY id ASC LIMIT ?`;
        const { results } = await this.db.prepare(query).bind(limit).all();
        return results;
    }

    async getRecentGuesses(limit = 14) {
        const query = `SELECT * FROM guess_pool ORDER BY id DESC LIMIT ?`;
        const { results } = await this.db.prepare(query).bind(limit).all();
        return results;
    }

    async saveGuessWord(word, scrambled, clue) {
        const query = `
            INSERT INTO guess_pool (word, scrambled, clue)
            VALUES (?, ?, ?)
        `;
        const result = await this.db.prepare(query).bind(word, scrambled, clue).run();
        return result.success;
    }

    async markGuessAsSent(guessId) {
        const query = `UPDATE guess_pool SET is_used = 1, sent_at = CURRENT_TIMESTAMP WHERE id = ?`;
        const result = await this.db.prepare(query).bind(guessId).run();
        return result.success;
    }

    async getActiveGuess() {
        const query = `
            SELECT * FROM guess_pool 
            WHERE is_used = 1 AND is_guessed = 0 
            ORDER BY sent_at DESC LIMIT 1
        `;
        return this.db.prepare(query).first();
    }

    async resolveGuess(guessId, winnerId, winnerUsername) {
        const query = `
            UPDATE guess_pool 
            SET is_guessed = 1, winner_id = ?, winner_username = ? 
            WHERE id = ?
        `;
        const result = await this.db.prepare(query).bind(winnerId, winnerUsername || null, guessId).run();
        return result.success;
    }

    async updatePlayerScore(chatId, userId, username, firstName, points) {
        const query = `
            INSERT INTO game_scores (chat_id, user_id, username, first_name, score)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(chat_id, user_id) DO UPDATE SET
                username = COALESCE(excluded.username, username),
                first_name = excluded.first_name,
                score = score + excluded.score
        `;
        const result = await this.db.prepare(query).bind(chatId, userId, username || null, firstName, points).run();
        return result.success;
    }

    async getLeaderboard(chatId) {
        const query = `
            SELECT * FROM game_scores
            WHERE chat_id = ?
            ORDER BY score DESC
            LIMIT 10
        `;
        const { results } = await this.db.prepare(query).bind(chatId).all();
        return results;
    }
}
