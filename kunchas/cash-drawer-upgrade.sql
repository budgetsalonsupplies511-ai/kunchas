CREATE TABLE IF NOT EXISTS cash_drawer_opens (
  id TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('checkout', 'daily_closing')),
  reason TEXT NOT NULL DEFAULT '',
  sale_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_opens_branch_time
ON cash_drawer_opens(branch_id, opened_at DESC);
