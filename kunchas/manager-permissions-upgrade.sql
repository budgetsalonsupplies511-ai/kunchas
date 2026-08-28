CREATE TABLE IF NOT EXISTS manager_permissions (
  staff_id TEXT PRIMARY KEY,
  permissions TEXT NOT NULL DEFAULT '[]'
);
