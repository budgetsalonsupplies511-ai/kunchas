CREATE TABLE IF NOT EXISTS staff_time_entries (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  break_started_at TEXT,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Clocked in'
);

CREATE TABLE IF NOT EXISTS manager_branch_assignments (
  staff_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  PRIMARY KEY (staff_id, branch_id)
);

CREATE TABLE IF NOT EXISTS sale_edit_audit (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  manager_staff_id TEXT NOT NULL,
  edited_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_total_cents INTEGER NOT NULL,
  new_total_cents INTEGER NOT NULL,
  previous_payment_method TEXT,
  new_payment_method TEXT,
  previous_status TEXT,
  new_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_time_branch_clock_in ON staff_time_entries(branch_id, clock_in);