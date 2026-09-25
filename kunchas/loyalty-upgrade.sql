-- Apply once before deploying the loyalty-enabled Worker. Existing balances start at zero.
ALTER TABLE customers ADD COLUMN loyalty_points INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(loyalty_points) = 'integer' AND loyalty_points >= 0);

CREATE TABLE customer_loyalty_sales (
  sale_id TEXT PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  earned INTEGER NOT NULL CHECK (typeof(earned) = 'integer' AND earned >= 0),
  redeemed INTEGER NOT NULL CHECK (typeof(redeemed) = 'integer' AND (redeemed = 0 OR redeemed >= 500)),
  updated_at TEXT NOT NULL
);
CREATE INDEX customer_loyalty_sales_customer ON customer_loyalty_sales(customer_id);

-- This check and the sale write run in the same D1 batch transaction. Concurrent
-- checkouts cannot spend the same points or use this sale's earnings to qualify.
CREATE TRIGGER loyalty_sale_validate BEFORE INSERT ON customer_loyalty_sales BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM customers WHERE id = NEW.customer_id AND loyalty_points >= NEW.redeemed
  ) THEN RAISE(ABORT, 'LOYALTY_INSUFFICIENT_POINTS') END;
END;
CREATE TRIGGER loyalty_sale_award AFTER INSERT ON customer_loyalty_sales BEGIN
  UPDATE customers SET loyalty_points = loyalty_points + NEW.earned - NEW.redeemed
    WHERE id = NEW.customer_id;
END;
CREATE TRIGGER loyalty_sale_edit_validate BEFORE UPDATE ON customer_loyalty_sales BEGIN
  SELECT CASE WHEN NEW.customer_id != OLD.customer_id OR NEW.sale_id != OLD.sale_id OR NEW.redeemed != OLD.redeemed
    THEN RAISE(ABORT, 'LOYALTY_REDEMPTION_IMMUTABLE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM customers WHERE id = NEW.customer_id AND loyalty_points + NEW.earned - OLD.earned >= 0
  ) THEN RAISE(ABORT, 'LOYALTY_POINTS_ALREADY_SPENT') END;
END;
CREATE TRIGGER loyalty_sale_edit AFTER UPDATE ON customer_loyalty_sales BEGIN
  UPDATE customers SET loyalty_points = loyalty_points + NEW.earned - OLD.earned WHERE id = NEW.customer_id;
END;
