ALTER TABLE sale_items ADD COLUMN service_id TEXT;
ALTER TABLE sale_items ADD COLUMN staff_ids TEXT DEFAULT '[]';
