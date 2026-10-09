-- Step 1: Add owner_id column
ALTER TABLE hosting_databases
    ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

-- Step 2: Backfill owner_id from hosting_sites
UPDATE hosting_databases d
SET owner_id = s.owner_user_id
FROM hosting_sites s
WHERE d.site_id = s.id AND d.owner_id IS NULL;

-- Step 3: Make owner_id NOT NULL
ALTER TABLE hosting_databases
    ALTER COLUMN owner_id SET NOT NULL;

-- Step 4: Drop the NOT NULL constraint on site_id
ALTER TABLE hosting_databases
    ALTER COLUMN site_id DROP NOT NULL;

-- Step 5: Change foreign key to ON DELETE SET NULL
ALTER TABLE hosting_databases
    DROP CONSTRAINT IF EXISTS hosting_databases_site_id_fkey;

ALTER TABLE hosting_databases
    ADD CONSTRAINT hosting_databases_site_id_fkey 
    FOREIGN KEY (site_id) REFERENCES hosting_sites(id) ON DELETE SET NULL;

-- Step 6: Make site_id nullable in hosting_database_access_tickets
ALTER TABLE hosting_database_access_tickets
    ALTER COLUMN site_id DROP NOT NULL;

