-- ============================================================
--  EnosIII Bot — Supabase Schema
--  Run this entire file in Supabase SQL Editor
-- ============================================================


-- ─── 1. bot_config ───────────────────────────────────────────
--  Stores global bot settings (models, API keys, active model, etc.)
CREATE TABLE IF NOT EXISTS bot_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─── 2. users ────────────────────────────────────────────────
--  Stores authorized Telegram users and their preferences
CREATE TABLE IF NOT EXISTS users (
  chat_id        TEXT PRIMARY KEY,
  personality    TEXT DEFAULT NULL,
  pending_action TEXT DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 3. history ──────────────────────────────────────────────
--  Stores per-user conversation history
CREATE TABLE IF NOT EXISTS history (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    TEXT        NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS history_chat_id_idx ON history(chat_id);
CREATE INDEX IF NOT EXISTS history_created_at_idx ON history(chat_id, created_at);


-- ─── 4. Seed initial bot_config values ───────────────────────
--  Replace the API key and model values with your own if different.
--  These match the values from your original GAS script.

INSERT INTO bot_config (key, value) VALUES
  ('DEFAULT_MODEL',   'arcee-ai/trinity-large-preview:free'),
  ('ACTIVE_MODEL',    'arcee-ai/trinity-large-preview:free'),
  ('DEFAULT_API_KEY', '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'),
  ('ACTIVE_API_KEY',  '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'),
  ('MODELS',          '["arcee-ai/trinity-large-preview:free"]'),
  ('API_KEYS',        '["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"]')
ON CONFLICT (key) DO NOTHING;


-- ─── 5. Disable Row Level Security (bot uses service_role key) ─
ALTER TABLE bot_config DISABLE ROW LEVEL SECURITY;
ALTER TABLE users      DISABLE ROW LEVEL SECURITY;
ALTER TABLE history    DISABLE ROW LEVEL SECURITY;


-- ─── Done! ────────────────────────────────────────────────────
-- Tables created: bot_config, users, history
-- You can verify by running: SELECT * FROM bot_config;
