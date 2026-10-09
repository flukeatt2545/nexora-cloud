ALTER TABLE hosting_workspace_access_tokens
    ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

UPDATE hosting_workspace_access_tokens
SET revoked_at = NOW(), token = NULL
WHERE revoked_at IS NULL;

ALTER TABLE hosting_workspace_access_tokens
    ALTER COLUMN token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hosting_workspace_access_tokens_hash_idx
    ON hosting_workspace_access_tokens(token_hash)
    WHERE token_hash IS NOT NULL AND revoked_at IS NULL;

DROP INDEX IF EXISTS hosting_workspace_access_tokens_token_idx;
