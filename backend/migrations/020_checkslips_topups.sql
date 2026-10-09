ALTER TABLE topup_transactions
    ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS verification_id TEXT,
    ADD COLUMN IF NOT EXISTS trans_ref TEXT,
    ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(6, 5),
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_topup_transactions_verification_id
    ON topup_transactions (provider, verification_id)
    WHERE verification_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_topup_transactions_trans_ref
    ON topup_transactions (provider, trans_ref)
    WHERE trans_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_topup_transactions_user_created
    ON topup_transactions (user_id, created_at DESC);
