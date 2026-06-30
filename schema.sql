CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assigned_to_username TEXT,
    assigned_to_id INTEGER,
    status TEXT DEFAULT 'todo',
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    remind_at TIMESTAMP NOT NULL,
    is_sent INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quota_usage (
    model_name TEXT PRIMARY KEY,
    daily_count INTEGER DEFAULT 0,
    last_reset_date TEXT
);

CREATE TABLE IF NOT EXISTS message_history (
    message_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    text TEXT NOT NULL,
    reply_to_message_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, chat_id)
);

CREATE TABLE IF NOT EXISTS group_members (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT NOT NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS quiz_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    is_used INTEGER DEFAULT 0,
    is_answered INTEGER DEFAULT 0,
    winner_username TEXT,
    winner_id INTEGER,
    sent_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guess_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    scrambled TEXT NOT NULL,
    clue TEXT NOT NULL,
    is_used INTEGER DEFAULT 0,
    is_guessed INTEGER DEFAULT 0,
    winner_username TEXT,
    winner_id INTEGER,
    sent_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_scores (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT,
    first_name TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS game_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
