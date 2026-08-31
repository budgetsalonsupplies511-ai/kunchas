ALTER TABLE services ADD COLUMN sub_category TEXT NOT NULL DEFAULT 'General';

UPDATE services SET sub_category = CASE
  WHEN category = 'Hair' AND lower(name) LIKE '%cut%' THEN 'Cuts'
  WHEN category = 'Hair' AND lower(name) LIKE '%blow%' THEN 'Styling'
  WHEN category = 'Colour' THEN 'Colour'
  WHEN category = 'Treatment' THEN 'Treatments'
  WHEN category = 'Beauty' AND lower(name) LIKE '%facial%' THEN 'Facials'
  WHEN category = 'Beauty' AND lower(name) LIKE '%thread%' THEN 'Threading'
  ELSE 'General'
END;
