ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'Online';
ALTER TABLE staff ADD COLUMN hourly_rate_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN xero_employee_id TEXT NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN xero_earnings_rate_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_time_entries_staff_clock ON time_entries(staff_id, clock_in);
CREATE INDEX IF NOT EXISTS idx_time_entries_branch_clock ON time_entries(branch_id, clock_in);
