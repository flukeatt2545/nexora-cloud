-- 061: private delivery copies for store products + purchase history lookups.
-- delivery_key  : private object key (store-private/...) served only to buyers.
-- delivery_from : the admin file (file_key) the private copy was made from.
-- delivery_name : filename shown to the buyer when downloading.
-- Idempotent: safe to re-run on every backend startup (like other migrations).

ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_key TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_from TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_name TEXT;

CREATE INDEX IF NOT EXISTS idx_purchases_user_purchased_at
    ON purchases (user_id, purchased_at DESC);
