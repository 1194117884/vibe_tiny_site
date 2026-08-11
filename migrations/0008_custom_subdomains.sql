-- Exact customer subdomains through Cloudflare for SaaS. Root domains and DNS
-- hosting are deliberately excluded from this migration.
CREATE TABLE custom_domain_slots (
  slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 90),
  domain_id TEXT UNIQUE,
  updated_at INTEGER
);
WITH RECURSIVE slots(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM slots WHERE n < 90)
INSERT INTO custom_domain_slots(slot) SELECT n FROM slots;

CREATE TABLE custom_domains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  registrable_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'pending_dns', 'pending_ownership', 'pending_tls', 'active', 'error', 'deleting')),
  cf_custom_hostname_id TEXT UNIQUE,
  hostname_status TEXT,
  ssl_status TEXT,
  verification_records TEXT,
  error_message TEXT,
  verified_at INTEGER,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_custom_domains_project ON custom_domains(project_id, deleted_at, created_at);
CREATE INDEX idx_custom_domains_pending ON custom_domains(status, last_checked_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_custom_domains_hostname_active ON custom_domains(hostname) WHERE deleted_at IS NULL;
