ALTER TABLE daily_closings ADD COLUMN previous_cash_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_closings ADD COLUMN cash_taken_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_closings ADD COLUMN remaining_cash_cents INTEGER NOT NULL DEFAULT 0;

UPDATE daily_closings
SET remaining_cash_cents = actual_cash_cents
WHERE remaining_cash_cents = 0 AND actual_cash_cents > 0;
