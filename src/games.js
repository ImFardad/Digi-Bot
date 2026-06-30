import { TelegramClient } from './telegram.js';
import { DatabaseClient } from './db.js';
import { formatPersianDate } from './reminders.js';

/**
 * Generates 14 new technology quiz questions using Gemini and stores them in the pool.
 */
export async function generateQuizQuestions(db, geminiKey) {
    const dbClient = new DatabaseClient(db);
    
    // Fetch last 14 questions to avoid duplicates
    const recents = await dbClient.getRecentQuizzes(14);
    const recentTexts = recents.map(q => q.question);

    const prompt = `You are a technology trivia quiz generator. 
Generate exactly 14 new technology history/trivia/facts questions in English.
The questions must be about general technology, computing history, hardware, software, internet history, mobile tech, or key tech companies.
Ensure the questions are NOT similar to the following recent questions:
${JSON.stringify(recentTexts)}

For each question, provide 4 options and the correct_index (0-indexed).

JSON Output Schema:
[
  {
    "question": "What does SSD stand for?",
    "options": ["Solid State Drive", "Super Speed Disk", "Solid State Disk", "System Storage Device"],
    "correct_index": 0
  }
]

Response must be raw JSON array only. Do not wrap in markdown or backticks.`;

    for (const modelId of ['models/gemini-3.1-flash-lite-preview', 'models/gemini-3.5-flash']) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${geminiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                const cleanJson = extractJsonArray(text);
                if (cleanJson && Array.isArray(cleanJson)) {
                    for (const q of cleanJson) {
                        if (q.question && Array.isArray(q.options) && q.options.length === 4 && typeof q.correct_index === 'number') {
                            await dbClient.saveQuizQuestion(q.question, JSON.stringify(q.options), q.correct_index);
                        }
                    }
                    console.log("Successfully generated and saved 14 new quiz questions.");
                    return true;
                }
            }
        } catch (e) {
            console.error(`Quiz generation failed on model ${modelId}:`, e);
        }
    }
    return false;
}

/**
 * Generates 14 new technology words for guessing using Gemini and stores them in the pool.
 */
export async function generateWordGuesses(db, geminiKey) {
    const dbClient = new DatabaseClient(db);

    const recents = await dbClient.getRecentGuesses(14);
    const recentWords = recents.map(w => w.word);

    const prompt = `You are a technology word puzzle generator.
Generate exactly 14 tech vocabulary words or terms in English.
Avoid these recent words:
${JSON.stringify(recentWords)}

Rules:
- The word must be a single clean word in CAPITAL letters (e.g. "MICROCHIP", "DATABASE", "MODEM").
- Scrambled must be the letters of the word separated by spaces in a random order (e.g. "P I H C O R C I M").
- Clue must be a clear description of the tech term.

JSON Output Schema:
[
  {
    "word": "DATABASE",
    "scrambled": "E B A A S T A D",
    "clue": "An organized collection of data stored and accessed electronically."
  }
]

Response must be raw JSON array only. Do not wrap in markdown or backticks.`;

    for (const modelId of ['models/gemini-3.1-flash-lite-preview', 'models/gemini-3.5-flash']) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${geminiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                const cleanJson = extractJsonArray(text);
                if (cleanJson && Array.isArray(cleanJson)) {
                    for (const w of cleanJson) {
                        if (w.word && w.scrambled && w.clue) {
                            await dbClient.saveGuessWord(w.word.toUpperCase().trim(), w.scrambled, w.clue);
                        }
                    }
                    console.log("Successfully generated and saved 14 new word guesses.");
                    return true;
                }
            }
        } catch (e) {
            console.error(`Word guess generation failed on model ${modelId}:`, e);
        }
    }
    return false;
}

/**
 * Handles incoming quiz inline button callback queries.
 */
export async function handleQuizCallback(update, db, token) {
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(token);

    const cbQuery = update.callback_query;
    const data = cbQuery.data; // Format: "quiz:[quizId]:[clickedIndex]"
    const parts = data.split(':');
    const quizId = parseInt(parts[1], 10);
    const clickedIndex = parseInt(parts[2], 10);

    const chatId = cbQuery.message.chat.id;
    const userId = cbQuery.from.id;
    const username = cbQuery.from.username;
    const firstName = cbQuery.from.first_name;

    // Check if user already attempted and failed
    const hasAttempted = await dbClient.getGameSetting(`quiz_attempt:${quizId}:${userId}`);
    if (hasAttempted) {
        await tgClient.request('answerCallbackQuery', {
            callback_query_id: cbQuery.id,
            text: "❌ You already answered incorrectly! You only get 1 attempt.",
            show_alert: true
        });
        return;
    }

    // Fetch active quiz
    const active = await dbClient.getActiveQuiz();
    if (!active || active.id !== quizId) {
        await tgClient.request('answerCallbackQuery', {
            callback_query_id: cbQuery.id,
            text: "⏱️ This quiz has already ended or is inactive!",
            show_alert: true
        });
        return;
    }

    const options = JSON.parse(active.options);

    // Correct Answer Check
    if (clickedIndex === active.correct_index) {
        // Resolve Quiz
        await dbClient.resolveQuiz(quizId, userId, username);
        // Award +10 points
        await dbClient.updatePlayerScore(chatId, userId, username, firstName, 10);

        // Edit message to resolve state
        const winnerText = username ? `@${username}` : firstName;
        const resolvedText = `🎮 <b>Tech Quiz (Resolved)</b>\n\n` +
                             `📝 <b>Question:</b> ${active.question}\n\n` +
                             `🏆 <b>Winner:</b> ${winnerText} (+10 points)\n` +
                             `✅ <b>Correct Answer:</b> ${options[active.correct_index]}`;
        
        await tgClient.request('editMessageText', {
            chat_id: chatId,
            message_id: cbQuery.message.message_id,
            text: resolvedText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
        });

        await tgClient.request('answerCallbackQuery', {
            callback_query_id: cbQuery.id,
            text: "🎉 Correct! You earned 10 points! 🏆"
        });
    } else {
        // Locked out
        await dbClient.setGameSetting(`quiz_attempt:${quizId}:${userId}`, "1");
        await tgClient.request('answerCallbackQuery', {
            callback_query_id: cbQuery.id,
            text: "❌ Incorrect! You are locked out of this question.",
            show_alert: true
        });
    }
}

/**
 * Intercepts group messages to check if they match the active word guess secret.
 */
export async function checkWordGuessIncoming(message, db, token) {
    if (!message || !message.text) return false;
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(token);

    const active = await dbClient.getActiveGuess();
    if (!active) return false;

    const cleanInput = message.text.trim().toUpperCase();
    if (cleanInput === active.word.toUpperCase()) {
        const chatId = message.chat.id;
        const userId = message.from.id;
        const username = message.from.username;
        const firstName = message.from.first_name;

        // Resolve
        await dbClient.resolveGuess(active.id, userId, username);
        await dbClient.updatePlayerScore(chatId, userId, username, firstName, 10);

        const winnerText = username ? `@${username}` : firstName;
        const winMessage = `🏆 <b>Correct!</b>\n\n` +
                           `👤 ${winnerText} guessed the word <b>${active.word}</b> and earned <b>+10 points</b>! 🎮`;
        await tgClient.sendMessage(chatId, winMessage);
        return true; // Answered successfully
    }
    return false;
}

/**
 * Renders the leaderboard scoreboard.
 */
export async function handleLeaderboard(update, db, token) {
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(token);

    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const scores = await dbClient.getLeaderboard(chatId);

    if (scores.length === 0) {
        await tgClient.sendMessage(chatId, "🏆 <b>Leaderboard:</b>\n\nNo points recorded yet in this chat. Play games to earn points!");
        return;
    }

    let report = `🏆 <b>جدول امتیازات بازی‌های تکنولوژی گروه:</b>\n\n`;
    scores.forEach((p, idx) => {
        const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•';
        const userLink = p.username ? `@${p.username}` : p.first_name;
        report += `${rankEmoji} <b>${userLink}</b>: <code>${p.score} امتیاز</code>\n`;
    });

    await tgClient.sendMessage(chatId, report.trim());
}

/**
 * Scheduler check run by the minute cron trigger.
 * Resolves expired games and fires new random ones daily.
 */
export async function checkAndSendDailyGames(db, token, geminiKey, targetChatId) {
    const dbClient = new DatabaseClient(db);
    const tgClient = new TelegramClient(token);

    const now = new Date();

    // ==========================================
    // 1. SCHEDULER: TECH QUIZ GAME
    // ==========================================
    let nextQuizTimeStr = await dbClient.getGameSetting("next_quiz_time");
    if (!nextQuizTimeStr) {
        // Schedule first quiz for 10 minutes from now
        const firstQuiz = new Date(now.getTime() + 10 * 60 * 1000);
        await dbClient.setGameSetting("next_quiz_time", firstQuiz.toISOString());
        nextQuizTimeStr = firstQuiz.toISOString();
    }

    const nextQuizTime = new Date(nextQuizTimeStr);
    if (now >= nextQuizTime) {
        try {
            // Resolve previous active quiz if unanswered
            const activeQuiz = await dbClient.getActiveQuiz();
            if (activeQuiz) {
                await dbClient.resolveQuiz(activeQuiz.id, 0, 'none');
                const options = JSON.parse(activeQuiz.options);
                const correctOption = options[activeQuiz.correct_index];
                await tgClient.sendMessage(targetChatId, `⏱️ <b>Time is up!</b>\n\nNobody answered the previous quiz. The correct answer was: <b>${correctOption}</b>`);
            }

            // Get next unused quiz
            let unused = await dbClient.getUnusedQuizzes(1);
            if (unused.length === 0) {
                await generateQuizQuestions(db, geminiKey);
                unused = await dbClient.getUnusedQuizzes(1);
            }

            if (unused.length > 0) {
                const quiz = unused[0];
                await dbClient.markQuizAsSent(quiz.id);

                const options = JSON.parse(quiz.options);
                const buttons = options.map((opt, idx) => {
                    return [{ text: opt, callback_data: `quiz:${quiz.id}:${idx}` }];
                });

                const quizMessage = `🎮 <b>Tech Quiz Time!</b>\n\n` +
                                    `📝 <b>Question:</b>\n${quiz.question}`;
                
                await tgClient.request('sendMessage', {
                    chat_id: targetChatId,
                    text: quizMessage,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: buttons }
                });
            }

            // Schedule next quiz: tomorrow + random offset (0 to 4 hours)
            const randomOffsetMs = Math.floor(Math.random() * 4 * 60 * 60 * 1000);
            const tomorrowQuiz = new Date(now.getTime() + 24 * 60 * 60 * 1000 + randomOffsetMs);
            await dbClient.setGameSetting("next_quiz_time", tomorrowQuiz.toISOString());
            console.log(`Scheduled next quiz for: ${tomorrowQuiz.toISOString()}`);
        } catch (e) {
            console.error("Daily quiz posting failed:", e);
        }
    }

    // ==========================================
    // 2. SCHEDULER: TECH WORD GUESS GAME
    // ==========================================
    let nextGuessTimeStr = await dbClient.getGameSetting("next_guess_time");
    if (!nextGuessTimeStr) {
        // Schedule first guess for 30 minutes from now
        const firstGuess = new Date(now.getTime() + 30 * 60 * 1000);
        await dbClient.setGameSetting("next_guess_time", firstGuess.toISOString());
        nextGuessTimeStr = firstGuess.toISOString();
    }

    const nextGuessTime = new Date(nextGuessTimeStr);
    if (now >= nextGuessTime) {
        try {
            // Resolve previous guess if unguessed
            const activeGuess = await dbClient.getActiveGuess();
            if (activeGuess) {
                await dbClient.resolveGuess(activeGuess.id, 0, 'none');
                await tgClient.sendMessage(targetChatId, `⏱️ <b>Time is up!</b>\n\nNobody guessed the word. The correct term was: <b>${activeGuess.word}</b>`);
            }

            // Get next unused word guess
            let unused = await dbClient.getUnusedGuesses(1);
            if (unused.length === 0) {
                await generateWordGuesses(db, geminiKey);
                unused = await dbClient.getUnusedGuesses(1);
            }

            if (unused.length > 0) {
                const guess = unused[0];
                await dbClient.markGuessAsSent(guess.id);

                const guessMessage = `🎮 <b>Tech Word Guess!</b>\n\n` +
                                     `Rearrange these letters to form a technology term:\n` +
                                     `🔠 <b>${guess.scrambled}</b>\n\n` +
                                     `💡 Clue: <i>${guess.clue}</i>\n\n` +
                                     `Type the correct word in the chat to win +10 points! 🏆`;
                
                await tgClient.sendMessage(targetChatId, guessMessage);
            }

            // Schedule next guess: tomorrow + random offset (0 to 4 hours)
            const randomOffsetMs = Math.floor(Math.random() * 4 * 60 * 60 * 1000);
            const tomorrowGuess = new Date(now.getTime() + 24 * 60 * 60 * 1000 + randomOffsetMs);
            await dbClient.setGameSetting("next_guess_time", tomorrowGuess.toISOString());
            console.log(`Scheduled next guess for: ${tomorrowGuess.toISOString()}`);
        } catch (e) {
            console.error("Daily guess posting failed:", e);
        }
    }
}

/**
 * Helper to extract JSON arrays safely from models.
 */
function extractJsonArray(text) {
    if (!text) return null;
    try {
        const start = text.indexOf('[');
        const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            const jsonStr = text.substring(start, end + 1);
            return JSON.parse(jsonStr);
        }
    } catch (e) {
        console.error("Failed to parse JSON array from text:", text);
    }
    return null;
}
