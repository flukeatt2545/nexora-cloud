-- Deleting a user failed with a foreign-key error whenever the account had ever created a mailbox,
-- mail alias or device credential, or owned a site that was already soft-deleted. None of those
-- rows should keep the account alive: the creator is only an audit field, and a deleted site is
-- invisible. Live sites are still protected by the handler (the owner must be transferred first)
-- and by the CHECK below.
ALTER TABLE mailboxes ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE mailboxes DROP CONSTRAINT IF EXISTS mailboxes_created_by_fkey;
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE mail_aliases ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE mail_aliases DROP CONSTRAINT IF EXISTS mail_aliases_created_by_fkey;
ALTER TABLE mail_aliases ADD CONSTRAINT mail_aliases_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE mail_device_credentials ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE mail_device_credentials DROP CONSTRAINT IF EXISTS mail_device_credentials_created_by_fkey;
ALTER TABLE mail_device_credentials ADD CONSTRAINT mail_device_credentials_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE hosting_sites ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE hosting_sites DROP CONSTRAINT IF EXISTS hosting_sites_owner_user_id_fkey;
ALTER TABLE hosting_sites ADD CONSTRAINT hosting_sites_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hosting_sites DROP CONSTRAINT IF EXISTS hosting_sites_live_owner_check;
ALTER TABLE hosting_sites ADD CONSTRAINT hosting_sites_live_owner_check
    CHECK (deleted_at IS NOT NULL OR owner_user_id IS NOT NULL);
