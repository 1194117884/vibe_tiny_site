-- 兑换码从注册门槛改为注册后的套餐权益赠送。
ALTER TABLE activation_codes ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS plan_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  duration_days INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('activation_code', 'simulated_purchase', 'admin_grant')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'expired', 'revoked', 'refunded')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entitlements_schedule
  ON plan_entitlements(user_id, status, starts_at, ends_at);
