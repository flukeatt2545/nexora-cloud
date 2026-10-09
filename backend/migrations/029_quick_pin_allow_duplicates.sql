-- Allow the same 4-digit quick PIN across users.
-- Identity claim resolves by hashed PIN (+ username when ambiguous).
DROP INDEX IF EXISTS idx_users_quick_pin_lookup;

CREATE INDEX IF NOT EXISTS idx_users_quick_pin_lookup
    ON users (quick_pin_lookup)
    WHERE quick_pin_lookup IS NOT NULL;
