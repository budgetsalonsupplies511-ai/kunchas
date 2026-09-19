ALTER TABLE products ADD COLUMN sub_category TEXT NOT NULL DEFAULT 'General';
ALTER TABLE products ADD COLUMN special_price_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS product_category_order (
  category TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
