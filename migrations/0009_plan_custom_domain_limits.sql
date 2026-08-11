ALTER TABLE plans ADD COLUMN custom_domain_limit INTEGER NOT NULL DEFAULT 0;

UPDATE plans SET monthly_price_cents = 0, custom_domain_limit = 0 WHERE id = 'free';
UPDATE plans SET monthly_price_cents = 1990, custom_domain_limit = 1 WHERE id = 'pro';
UPDATE plans SET monthly_price_cents = 3990, custom_domain_limit = 3 WHERE id = 'plus';
UPDATE plans SET monthly_price_cents = 9990, custom_domain_limit = project_limit WHERE id = 'ultra';

CREATE TABLE custom_domains_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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

INSERT INTO custom_domains_v2
  (id, project_id, hostname, registrable_domain, status, cf_custom_hostname_id,
   hostname_status, ssl_status, verification_records, error_message, verified_at,
   last_checked_at, created_at, updated_at, deleted_at)
SELECT id, project_id, hostname, registrable_domain, status, cf_custom_hostname_id,
       hostname_status, ssl_status, verification_records, error_message, verified_at,
       last_checked_at, created_at, updated_at, deleted_at
FROM custom_domains;

DROP TABLE custom_domains;
ALTER TABLE custom_domains_v2 RENAME TO custom_domains;
DROP TABLE custom_domain_slots;

CREATE INDEX idx_custom_domains_project ON custom_domains(project_id, deleted_at, created_at);
CREATE INDEX idx_custom_domains_pending ON custom_domains(status, last_checked_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_custom_domains_hostname_active ON custom_domains(hostname) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_custom_domains_project_active ON custom_domains(project_id) WHERE deleted_at IS NULL;
