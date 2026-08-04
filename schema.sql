-- =============================================================
-- TinySite · D1 数据库表结构
-- projects : 项目（一个项目 = 一个独立网站空间 + 固定访问地址）
-- versions : 部署版本（每次拖拽上传生成一个版本，支持回滚）
-- files    : 版本内文件清单（相对路径 -> R2 对象键）
-- =============================================================

CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,            -- p_xxxx
  name               TEXT NOT NULL,               -- 项目名称
  slug               TEXT NOT NULL UNIQUE,        -- URL 标识，决定固定访问地址 /s/{slug}/
  created_at         INTEGER NOT NULL,            -- 创建时间（Unix 毫秒）
  current_version_id TEXT                         -- 当前发布版本 -> versions.id
);

CREATE TABLE IF NOT EXISTS versions (
  id          TEXT PRIMARY KEY,                   -- v_xxxx
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,                   -- 项目内递增版本号：v1, v2, v3...
  file_count  INTEGER NOT NULL DEFAULT 0,         -- 文件数量
  total_size  INTEGER NOT NULL DEFAULT 0,         -- 总字节数
  status      TEXT NOT NULL DEFAULT 'uploading',  -- uploading / active / failed
  created_at  INTEGER NOT NULL,                   -- 部署时间（Unix 毫秒）
  UNIQUE (project_id, version)
);
ALTER TABLE versions ADD COLUMN note TEXT;

CREATE TABLE IF NOT EXISTS files (
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,                      -- 站点内相对路径，如 assets/app.js
  r2_key      TEXT NOT NULL,                      -- R2 对象键
  size        INTEGER NOT NULL DEFAULT 0,
  mime        TEXT,
  PRIMARY KEY (version_id, path)
);

CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_files_version ON files(version_id);

-- 增量部署：file_changes 只记录一次发布实际改动的文件；
-- project_files 保存当前线上文件树，files 继续作为历史版本的快速文件索引。
CREATE TABLE IF NOT EXISTS file_changes (
  version_id  TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  r2_key      TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  mime        TEXT,
  PRIMARY KEY (version_id, path)
);

CREATE TABLE IF NOT EXISTS project_files (
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path                TEXT NOT NULL,
  r2_key              TEXT NOT NULL,
  size                INTEGER NOT NULL DEFAULT 0,
  mime                TEXT,
  updated_version_id  TEXT NOT NULL REFERENCES versions(id),
  PRIMARY KEY (project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_changes_version ON file_changes(version_id);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);

-- 账号、套餐、激活码及按月流量。新环境初始化时一并创建。
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  monthly_price_cents INTEGER NOT NULL,
  project_limit INTEGER NOT NULL,
  storage_limit_bytes INTEGER NOT NULL,
  traffic_limit_bytes INTEGER NOT NULL
);
INSERT OR REPLACE INTO plans VALUES
  ('free', 0, 1, 104857600, 5368709120),
  ('pro', 1990, 5, 2147483648, 107374182400),
  ('plus', 2990, 10, 10737418240, 536870912000),
  ('ultra', 5990, 30, 53687091200, 2199023255552);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id), plan_expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  activation_code_id TEXT REFERENCES activation_codes(id), created_at INTEGER NOT NULL,
  google_sub TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activation_codes (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, code_display TEXT, plan_id TEXT NOT NULL REFERENCES plans(id),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')), max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id)
);
ALTER TABLE activation_codes ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS plan_entitlements (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id), duration_days INTEGER NOT NULL,
  source_type TEXT NOT NULL, source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'queued', starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entitlements_schedule ON plan_entitlements(user_id, status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS monthly_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, period TEXT NOT NULL,
  traffic_bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, period)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id), action TEXT NOT NULL,
  target_type TEXT NOT NULL, target_id TEXT, detail TEXT, created_at INTEGER NOT NULL
);
ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
