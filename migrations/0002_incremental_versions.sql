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
