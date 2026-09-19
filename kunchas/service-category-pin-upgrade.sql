ALTER TABLE service_category_order ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

INSERT INTO service_category_order (category, sort_order, pinned, updated_at)
SELECT DISTINCT category, 100000, 1, datetime('now')
FROM services
WHERE lower(trim(category)) LIKE '%special%'
ON CONFLICT(category) DO UPDATE SET pinned = 1, updated_at = excluded.updated_at;
