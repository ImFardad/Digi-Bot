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
