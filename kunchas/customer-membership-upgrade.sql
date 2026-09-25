-- Apply once before deploying POS membership enrollment.
ALTER TABLE customers ADD COLUMN membership_status TEXT
  CHECK (membership_status IS NULL OR membership_status IN ('Member', 'Non-member'));
ALTER TABLE customers ADD COLUMN membership_added_at TEXT;
ALTER TABLE customers ADD COLUMN membership_added_by_id TEXT;
ALTER TABLE customers ADD COLUMN membership_added_by_name TEXT;
