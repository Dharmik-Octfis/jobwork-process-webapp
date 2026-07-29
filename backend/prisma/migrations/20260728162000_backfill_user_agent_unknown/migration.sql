-- Backfill users that were created before user_agent was captured or from clients
-- that do not send a User-Agent header.
UPDATE "users"
SET "user_agent" = 'unknown'
WHERE "user_agent" IS NULL;