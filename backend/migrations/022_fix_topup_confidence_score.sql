ALTER TABLE topup_transactions
    ALTER COLUMN confidence_score TYPE NUMERIC(8, 5)
    USING confidence_score::NUMERIC(8, 5);
