ALTER TABLE services ADD COLUMN sub_category TEXT NOT NULL DEFAULT 'General';

UPDATE services SET sub_category = CASE
  WHEN lower(name) LIKE '%cut%' THEN 'Cuts'
  WHEN lower(name) LIKE '%blow%' OR lower(name) LIKE '%style%' THEN 'Styling'
  WHEN lower(name) LIKE '%colour%' OR lower(name) LIKE '%color%' THEN 'Colour'
  WHEN lower(name) LIKE '%treatment%' OR lower(name) LIKE '%botox%' THEN 'Treatments'
  WHEN lower(name) LIKE '%facial%' THEN 'Facials'
  WHEN lower(name) LIKE '%thread%' THEN 'Threading'
  ELSE 'General'
END;
