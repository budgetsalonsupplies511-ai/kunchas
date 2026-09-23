ALTER TABLE sales ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS held_sales (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  booking_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS held_sales_branch_updated ON held_sales(branch_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS held_sales_booking ON held_sales(booking_id) WHERE booking_id IS NOT NULL;
