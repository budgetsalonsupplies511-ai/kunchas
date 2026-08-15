CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  sku TEXT,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
);

INSERT OR IGNORE INTO products (id, name, brand, category, sku, price_cents, status) VALUES
  ('product-shampoo', 'Hydrating shampoo', 'Kunchas', 'Haircare', 'KUN-SHAMPOO', 2800, 'Active'),
  ('product-conditioner', 'Repair conditioner', 'Kunchas', 'Haircare', 'KUN-CONDITIONER', 3000, 'Active'),
  ('product-serum', 'Smoothing serum', 'Kunchas', 'Styling', 'KUN-SERUM', 3500, 'Active');
