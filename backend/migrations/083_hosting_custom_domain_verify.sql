-- A custom domain is only served once the site's owner has proved control of it with a DNS TXT
-- record. Until then the claim is stored but unused, so nobody can squat a name they do not own.
ALTER TABLE hosting_sites ADD COLUMN IF NOT EXISTS custom_domain_token TEXT;
ALTER TABLE hosting_sites ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

UPDATE hosting_sites
SET custom_domain_token = replace(gen_random_uuid()::text, '-', '')
WHERE custom_domain IS NOT NULL AND custom_domain <> '' AND custom_domain_token IS NULL;

DROP INDEX IF EXISTS hosting_sites_custom_domain_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS hosting_sites_custom_domain_verified_unique
    ON hosting_sites (LOWER(custom_domain))
    WHERE custom_domain IS NOT NULL AND custom_domain <> '' AND deleted_at IS NULL
      AND custom_domain_verified_at IS NOT NULL;
