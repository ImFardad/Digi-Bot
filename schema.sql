-- Database Schema for Digi-Bot

-- Active Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    assigned_to_username TEXT, -- Telegram Username
    assigned_to_id INTEGER,    -- Telegram numeric ID
    status TEXT DEFAULT 'todo', -- 'todo', 'done'
    created_by TEXT,           -- Creator's username/name
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Active Reminders Table
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    remind_at TIMESTAMP NOT NULL, -- Stored as UTC ISO8601 string or numeric timestamp
    is_sent INTEGER DEFAULT 0     -- 0 = pending, 1 = sent
);

-- API Quota Logs Table
CREATE TABLE IF NOT EXISTS quota_usage (
    model_name TEXT PRIMARY KEY,
    daily_count INTEGER DEFAULT 0,
    last_reset_date TEXT         -- YYYY-MM-DD
);
