-- Enforce capacity inside the database so simultaneous online/manual writes cannot overbook.
CREATE INDEX IF NOT EXISTS idx_booking_capacity ON bookings(branch_id,booking_date,status);
CREATE TABLE IF NOT EXISTS public_booking_requests (booking_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS bookings_capacity_insert BEFORE INSERT ON bookings
WHEN NEW.status NOT IN ('Cancelled','No show')
BEGIN
  SELECT RAISE(ABORT,'BOOKING_CAPACITY') WHERE EXISTS (
    SELECT 1 FROM (
      SELECT CAST(substr(NEW.booking_time,1,2) AS INTEGER)*60+CAST(substr(NEW.booking_time,4,2) AS INTEGER) AS point
      UNION
      SELECT CAST(substr(booking_time,1,2) AS INTEGER)*60+CAST(substr(booking_time,4,2) AS INTEGER)
      FROM bookings WHERE branch_id=NEW.branch_id AND booking_date=NEW.booking_date AND status NOT IN ('Cancelled','No show')
    ) points
    WHERE point >= CAST(substr(NEW.booking_time,1,2) AS INTEGER)*60+CAST(substr(NEW.booking_time,4,2) AS INTEGER)
      AND point < CAST(substr(NEW.booking_time,1,2) AS INTEGER)*60+CAST(substr(NEW.booking_time,4,2) AS INTEGER)+MAX(15,NEW.duration_minutes)
      AND (SELECT COUNT(*) FROM bookings b WHERE b.branch_id=NEW.branch_id AND b.booking_date=NEW.booking_date AND b.status NOT IN ('Cancelled','No show')
        AND CAST(substr(b.booking_time,1,2) AS INTEGER)*60+CAST(substr(b.booking_time,4,2) AS INTEGER)<=point
        AND CAST(substr(b.booking_time,1,2) AS INTEGER)*60+CAST(substr(b.booking_time,4,2) AS INTEGER)+MAX(15,b.duration_minutes)>point)>=4
  );
END;
CREATE TRIGGER IF NOT EXISTS bookings_capacity_update BEFORE UPDATE OF branch_id,booking_date,booking_time,duration_minutes,status ON bookings
WHEN NEW.status NOT IN ('Cancelled','No show') AND (OLD.status IN ('Cancelled','No show') OR NEW.branch_id!=OLD.branch_id OR NEW.booking_date!=OLD.booking_date OR NEW.booking_time!=OLD.booking_time OR NEW.duration_minutes!=OLD.duration_minutes)
BEGIN
  SELECT RAISE(ABORT,'BOOKING_CAPACITY') WHERE EXISTS (
    SELECT 1 FROM (
      SELECT CAST(substr(NEW.booking_time,1,2) AS INTEGER)*60+CAST(substr(NEW.booking_time,4,2) AS INTEGER) AS point
      UNION
      SELECT CAST(substr(booking_time,1,2) AS INTEGER)*60+CAST(substr(booking_time,4,2) AS INTEGER)
      FROM bookings WHERE id!=OLD.id AND branch_id=NEW.branch_id AND booking_date=NEW.booking_date AND status NOT IN ('Cancelled','No show')
    ) points
    WHERE point >= CAST(substr(NEW.booking_time,1,2) AS INTEGER)*60+CAST(substr(NEW.booking_time,4,2) AS INTEGER)
      AND point < CAST(substr(NEW.booking_time,1,2) AS INTEGER)*60+CAST(substr(NEW.booking_time,4,2) AS INTEGER)+MAX(15,NEW.duration_minutes)
      AND (SELECT COUNT(*) FROM bookings b WHERE b.id!=OLD.id AND b.branch_id=NEW.branch_id AND b.booking_date=NEW.booking_date AND b.status NOT IN ('Cancelled','No show')
        AND CAST(substr(b.booking_time,1,2) AS INTEGER)*60+CAST(substr(b.booking_time,4,2) AS INTEGER)<=point
        AND CAST(substr(b.booking_time,1,2) AS INTEGER)*60+CAST(substr(b.booking_time,4,2) AS INTEGER)+MAX(15,b.duration_minutes)>point)>=4
  );
END;
