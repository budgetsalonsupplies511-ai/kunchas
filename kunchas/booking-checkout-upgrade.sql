ALTER TABLE bookings ADD COLUMN sale_id TEXT;

INSERT OR IGNORE INTO customers (id, created_at, updated_at, first_name, last_name, email, phone, branch_id, tags, notes) VALUES
  ('sample-customer-olivia', datetime('now'), datetime('now'), 'Olivia', 'Brown', 'olivia.sample@kunchas.local', '0400 555 101', 'branch-city', 'Sample booking', 'Sample data for POS checkout testing'),
  ('sample-customer-jack', datetime('now'), datetime('now'), 'Jack', 'Wilson', 'jack.sample@kunchas.local', '0400 555 102', 'branch-parramatta', 'Sample booking', 'Sample data for POS checkout testing'),
  ('sample-customer-sophia', datetime('now'), datetime('now'), 'Sophia', 'Nguyen', 'sophia.sample@kunchas.local', '0400 555 103', 'branch-liverpool', 'Sample booking', 'Sample data for POS checkout testing'),
  ('sample-customer-liam', datetime('now'), datetime('now'), 'Liam', 'Davis', 'liam.sample@kunchas.local', '0400 555 104', 'branch-blacktown', 'Sample booking', 'Sample data for POS checkout testing'),
  ('sample-customer-zara', datetime('now'), datetime('now'), 'Zara', 'Khan', 'zara.sample@kunchas.local', '0400 555 105', 'branch-hurstville', 'Sample booking', 'Sample data for POS checkout testing');

INSERT OR IGNORE INTO bookings (id, created_at, updated_at, customer_id, branch_id, staff_id, service_ids, service_names, booking_date, booking_time, duration_minutes, total_cents, status, payment_status, sale_id, notes) VALUES
  ('sample-booking-city', datetime('now'), datetime('now'), 'sample-customer-olivia', 'branch-city', 'staff-mia', '["service-haircut","service-treatment"]', 'Haircut, Hair treatment', date('now', '+1 day'), '10:00', 75, 11500, 'Confirmed', 'Pay at store', NULL, 'Sample booking — ready for POS checkout'),
  ('sample-booking-parramatta', datetime('now'), datetime('now'), 'sample-customer-jack', 'branch-parramatta', 'staff-ava', '["service-colour"]', 'Colour service', date('now', '+1 day'), '13:30', 90, 12000, 'Booked', 'Pay at store', NULL, 'Sample booking — ready for POS checkout'),
  ('sample-booking-liverpool', datetime('now'), datetime('now'), 'sample-customer-sophia', 'branch-liverpool', 'staff-noah', '["service-blowdry"]', 'Blow dry', date('now', '+2 day'), '09:30', 35, 5500, 'Confirmed', 'Pay at store', NULL, 'Sample booking — ready for POS checkout'),
  ('sample-booking-blacktown', datetime('now'), datetime('now'), 'sample-customer-liam', 'branch-blacktown', 'staff-ella', '["service-facial"]', 'Beauty facial', date('now', '+2 day'), '15:00', 60, 9500, 'Booked', 'Pay at store', NULL, 'Sample booking — ready for POS checkout'),
  ('sample-booking-hurstville', datetime('now'), datetime('now'), 'sample-customer-zara', 'branch-hurstville', 'staff-lina', '["service-threading","service-haircut"]', 'Threading, Haircut', date('now', '+3 day'), '11:15', 50, 7000, 'Confirmed', 'Pay at store', NULL, 'Sample booking — ready for POS checkout');
