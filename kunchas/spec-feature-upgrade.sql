ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_stock (
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_level INTEGER NOT NULL DEFAULT 3,
  PRIMARY KEY (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  reason TEXT,
  reference TEXT
);

CREATE TABLE IF NOT EXISTS daily_closings (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  closing_date TEXT NOT NULL,
  opening_float_cents INTEGER NOT NULL DEFAULT 0,
  expected_cash_cents INTEGER NOT NULL DEFAULT 0,
  actual_cash_cents INTEGER NOT NULL DEFAULT 0,
  cash_variance_cents INTEGER NOT NULL DEFAULT 0,
  expected_card_cents INTEGER NOT NULL DEFAULT 0,
  actual_card_cents INTEGER NOT NULL DEFAULT 0,
  card_variance_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  closed_by TEXT,
  approved_by TEXT,
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_daily_closings_branch_date ON daily_closings(branch_id, closing_date);

UPDATE products SET cost_cents = 1200 WHERE id = 'product-shampoo' AND cost_cents = 0;
UPDATE products SET cost_cents = 1300 WHERE id = 'product-conditioner' AND cost_cents = 0;
UPDATE products SET cost_cents = 1500 WHERE id = 'product-serum' AND cost_cents = 0;
