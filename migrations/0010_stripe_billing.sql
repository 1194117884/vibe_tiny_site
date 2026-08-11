-- Stripe recurring billing. Webhook event IDs and invoice IDs provide
-- idempotency; paid invoices grant independent plan entitlements.
CREATE TABLE plan_entitlements_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  duration_days INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('activation_code', 'simulated_purchase', 'admin_grant', 'stripe_invoice')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'expired', 'revoked', 'refunded')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO plan_entitlements_v2
  (id, user_id, plan_id, duration_days, source_type, source_ref, status, starts_at, ends_at, created_at)
SELECT id, user_id, plan_id, duration_days, source_type, source_ref, status, starts_at, ends_at, created_at
FROM plan_entitlements;

DROP TABLE plan_entitlements;
ALTER TABLE plan_entitlements_v2 RENAME TO plan_entitlements;
CREATE INDEX idx_entitlements_schedule ON plan_entitlements(user_id, status, starts_at, ends_at);
CREATE UNIQUE INDEX idx_entitlements_stripe_invoice ON plan_entitlements(source_ref) WHERE source_type = 'stripe_invoice';

CREATE TABLE stripe_customers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE stripe_subscriptions (
  stripe_subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  current_period_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_stripe_subscriptions_user ON stripe_subscriptions(user_id, status, updated_at DESC);

CREATE TABLE stripe_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  amount_total INTEGER NOT NULL DEFAULT 0,
  amount_refunded INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_message TEXT,
  entitlement_id TEXT REFERENCES plan_entitlements(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_stripe_payments_user ON stripe_payments(user_id, created_at DESC);
CREATE INDEX idx_stripe_payments_subscription ON stripe_payments(stripe_subscription_id, created_at DESC);

CREATE TABLE stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'failed')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);
