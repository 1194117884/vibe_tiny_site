ALTER TABLE activation_codes ADD COLUMN code_display TEXT;
ALTER TABLE users ADD COLUMN activation_code_id TEXT REFERENCES activation_codes(id);
CREATE INDEX IF NOT EXISTS idx_users_activation_code ON users(activation_code_id, created_at DESC);
