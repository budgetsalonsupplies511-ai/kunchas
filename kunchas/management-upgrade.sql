CREATE TABLE IF NOT EXISTS branch_hours (
  branch_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  open_time TEXT NOT NULL,
  close_time TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS branch_closed_dates (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  closed_date TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE INDEX IF NOT EXISTS idx_branch_closed_dates ON branch_closed_dates(branch_id, closed_date);
