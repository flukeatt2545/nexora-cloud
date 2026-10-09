-- 062: admin refunds for store purchases.
-- A refunded purchase keeps its row (history) but no longer grants download access.
-- Idempotent: safe to re-run on every backend startup (like other migrations).

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refunded_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS refund_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_purchases_purchased_at ON purchases (purchased_at DESC);
