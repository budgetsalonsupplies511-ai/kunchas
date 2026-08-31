ALTER TABLE time_entries ADD COLUMN break_started_at TEXT;
ALTER TABLE time_entries ADD COLUMN break_minutes INTEGER NOT NULL DEFAULT 0;
