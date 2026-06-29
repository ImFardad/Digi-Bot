/**
 * Helper client to interact with the Telegram Bot API.
 */
export class TelegramClient {
    constructor(token) {
        if (!token) {
            throw new Error("Telegram Bot Token is required.");
        }
        this.token = token;
        this.baseUrl = `https://api.telegram.org/bot${token}`;
    }

    async request(method, payload = {}) {
        const url = `${this.baseUrl}/${method}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            console.error(`Telegram API error on ${method}:`, data);
            throw new Error(`Telegram API Error: ${data.description || response.statusText}`);
        }
        return data.result;
    }

    /**
     * Sends a text message to a chat.
     */
    async sendMessage(chatId, text, options = {}) {
        return this.request('sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            ...options
        });
    }

    /**
     * Edits a message text.
     */
    async editMessageText(chatId, messageId, text, options = {}) {
        return this.request('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'HTML',
            ...options
        });
    }

    /**
     * Answers an inline callback query.
     */
    async answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
        return this.request('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: text,
            show_alert: showAlert
        });
    }

    /**
     * Sends a voice message (audio file) using multipart/form-data.
     */
    async sendVoice(chatId, voiceBlob, filename = 'voice.wav', options = {}) {
        const url = `${this.baseUrl}/sendVoice`;
        const formData = new FormData();
        formData.append('chat_id', chatId.toString());
        formData.append('voice', voiceBlob, filename);

        // Add additional options
        for (const [key, value] of Object.entries(options)) {
            if (typeof value === 'object') {
                formData.append(key, JSON.stringify(value));
            } else {
                formData.append(key, value.toString());
            }
        }

        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (!response.ok) {
            console.error(`Telegram API error on sendVoice:`, data);
            throw new Error(`Telegram sendVoice Error: ${data.description || response.statusText}`);
        }
        return data.result;
    }
}
