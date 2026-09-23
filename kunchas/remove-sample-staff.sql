-- Hide untouched seed staff while keeping historical sale and booking attribution.
-- staff-ava was renamed to "manager" in production and is intentionally retained.
UPDATE staff SET status = 'Deleted'
WHERE (id = 'staff-mia' AND name = 'Mia Chen')
   OR (id = 'staff-noah' AND name = 'Noah Taylor')
   OR (id = 'staff-ella' AND name = 'Ella Martin')
   OR (id = 'staff-lina' AND name = 'Lina Patel');

DELETE FROM staff_roster WHERE staff_id IN
  (SELECT id FROM staff WHERE status = 'Deleted' AND id IN ('staff-mia', 'staff-noah', 'staff-ella', 'staff-lina'));
DELETE FROM staff_regular_days_off WHERE staff_id IN
  (SELECT id FROM staff WHERE status = 'Deleted' AND id IN ('staff-mia', 'staff-noah', 'staff-ella', 'staff-lina'));
UPDATE time_entries SET clock_out = clock_in, break_started_at = NULL
WHERE clock_out IS NULL AND staff_id IN
  (SELECT id FROM staff WHERE status = 'Deleted' AND id IN ('staff-mia', 'staff-noah', 'staff-ella', 'staff-lina'));
UPDATE bookings SET staff_id = NULL
WHERE booking_date >= date('now') AND status NOT IN ('Completed', 'Cancelled', 'No show') AND staff_id IN
  (SELECT id FROM staff WHERE status = 'Deleted' AND id IN ('staff-mia', 'staff-noah', 'staff-ella', 'staff-lina'));
