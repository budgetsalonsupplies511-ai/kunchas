CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  birthday TEXT,
  preferred_location TEXT NOT NULL,
  interests TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  campaign TEXT NOT NULL,
  membership_type TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
CREATE INDEX IF NOT EXISTS idx_members_created_at ON members(created_at);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  post_code TEXT,
  pin_code TEXT,
  status TEXT NOT NULL DEFAULT 'Open'
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
);

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

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  tags TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  staff_id TEXT,
  service_ids TEXT NOT NULL,
  service_names TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  booking_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_id TEXT,
  staff_id TEXT,
  total_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  service_id TEXT,
  staff_ids TEXT DEFAULT '[]',
  staff_allocations TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS branch_hours (
  branch_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,
  open_time TEXT NOT NULL,
  close_time TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS branch_closed_dates (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  closed_date TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
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

INSERT OR IGNORE INTO branches (id, name, address, phone, post_code, pin_code, status) VALUES
  ('branch-city', 'Kunchas City', 'City branch', '02 9000 1001', '2000', '2000', 'Open'),
  ('branch-parramatta', 'Kunchas Parramatta', 'Parramatta branch', '02 9000 1002', '2150', '2150', 'Open'),
  ('branch-liverpool', 'Kunchas Liverpool', 'Liverpool branch', '02 9000 1003', '2170', '2170', 'Open'),
  ('branch-blacktown', 'Kunchas Blacktown', 'Blacktown branch', '02 9000 1004', '2148', '2148', 'Open'),
  ('branch-hurstville', 'Kunchas Hurstville', 'Hurstville branch', '02 9000 1005', '2220', '2220', 'Open');

INSERT OR IGNORE INTO staff (id, branch_id, name, role, email, phone, status) VALUES
  ('staff-mia', 'branch-city', 'Mia Chen', 'Branch manager', 'mia@kunchas.com.au', '0400 100 001', 'Active'),
  ('staff-ava', 'branch-parramatta', 'Ava Singh', 'Senior stylist', 'ava@kunchas.com.au', '0400 100 002', 'Active'),
  ('staff-noah', 'branch-liverpool', 'Noah Taylor', 'Colour specialist', 'noah@kunchas.com.au', '0400 100 003', 'Active'),
  ('staff-ella', 'branch-blacktown', 'Ella Martin', 'Beauty therapist', 'ella@kunchas.com.au', '0400 100 004', 'Active'),
  ('staff-lina', 'branch-hurstville', 'Lina Patel', 'Salon coordinator', 'lina@kunchas.com.au', '0400 100 005', 'Active');

INSERT OR IGNORE INTO services (id, name, category, duration_minutes, price_cents, status) VALUES
  ('service-haircut', 'Haircut', 'Hair', 30, 4500, 'Active'),
  ('service-colour', 'Colour service', 'Colour', 90, 12000, 'Active'),
  ('service-treatment', 'Hair treatment', 'Treatment', 45, 7000, 'Active'),
  ('service-blowdry', 'Blow dry', 'Hair', 35, 5500, 'Active'),
  ('service-facial', 'Beauty facial', 'Beauty', 60, 9500, 'Active'),
  ('service-threading', 'Threading', 'Beauty', 20, 2500, 'Active');

INSERT OR IGNORE INTO products (id, name, brand, category, sku, barcode, cost_cents, price_cents, status) VALUES
  ('product-shampoo', 'Hydrating shampoo', 'Kunchas', 'Haircare', 'KUN-SHAMPOO', '', 1200, 2800, 'Active'),
  ('product-conditioner', 'Repair conditioner', 'Kunchas', 'Haircare', 'KUN-CONDITIONER', '', 1300, 3000, 'Active'),
  ('product-serum', 'Smoothing serum', 'Kunchas', 'Styling', 'KUN-SERUM', '', 1500, 3500, 'Active');

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_branch_closed_dates ON branch_closed_dates(branch_id, closed_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_daily_closings_branch_date ON daily_closings(branch_id, closing_date);
