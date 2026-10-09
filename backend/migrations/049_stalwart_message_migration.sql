ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS stalwart_email_id TEXT,
    ADD COLUMN IF NOT EXISTS stalwart_migrated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS stalwart_migration_error TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_stalwart_email_unique
    ON mail_messages(mailbox_id, stalwart_email_id)
    WHERE stalwart_email_id IS NOT NULL;
