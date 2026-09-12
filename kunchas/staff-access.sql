CREATE TABLE IF NOT EXISTS access_roles (
  role TEXT PRIMARY KEY CHECK(role IN ('admin','manager','staff')),
  permissions TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS access_users (
  id TEXT PRIMARY KEY,
  staff_id TEXT UNIQUE,
  username TEXT UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','manager','staff','none')),
  enabled INTEGER NOT NULL DEFAULT 0,
  all_branches INTEGER NOT NULL DEFAULT 0,
  branch_ids TEXT NOT NULL DEFAULT '[]',
  pin_salt TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES access_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_sessions_user ON access_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_access_sessions_expiry ON access_sessions(expires_at);
CREATE TABLE IF NOT EXISTS access_login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO access_roles(role,permissions) VALUES ('admin','{}'),('manager','{}'),('staff','{}');
