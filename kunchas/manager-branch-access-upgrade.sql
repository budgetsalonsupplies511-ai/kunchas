CREATE TABLE IF NOT EXISTS manager_branch_assignments (
  staff_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  PRIMARY KEY (staff_id, branch_id)
);
