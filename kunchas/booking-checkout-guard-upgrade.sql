-- Keep a paid booking linked to its first completed sale when two terminals check out at once.
CREATE TRIGGER IF NOT EXISTS bookings_checkout_once BEFORE UPDATE OF sale_id ON bookings
WHEN OLD.sale_id IS NOT NULL AND NEW.sale_id IS NOT OLD.sale_id
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_ALREADY_PAID');
END;
