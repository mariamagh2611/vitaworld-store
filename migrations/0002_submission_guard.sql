ALTER TABLE orders ADD COLUMN post_attempted INTEGER NOT NULL DEFAULT 0;
UPDATE orders SET post_attempted=1 WHERE mowarid_id IS NOT NULL OR EXISTS(SELECT 1 FROM jobs WHERE order_id=orders.id AND type='submit' AND attempts>0);
