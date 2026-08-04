-- Google One Tap / Sign in with Google：记录 Google subject，允许无密码账号
ALTER TABLE users ADD COLUMN google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
