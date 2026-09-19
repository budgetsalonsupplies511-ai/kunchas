CREATE TABLE IF NOT EXISTS service_category_order (
  category TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
