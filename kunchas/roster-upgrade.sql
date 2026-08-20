CREATE TABLE IF NOT EXISTS staff_roster (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  branch_id TEXT,
  roster_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL DEFAULT 'Working',
  notes TEXT,
  UNIQUE(staff_id, roster_date)
);

CREATE TABLE IF NOT EXISTS staff_regular_days_off (
  staff_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  PRIMARY KEY (staff_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_staff_roster_date ON staff_roster(roster_date, staff_id);
