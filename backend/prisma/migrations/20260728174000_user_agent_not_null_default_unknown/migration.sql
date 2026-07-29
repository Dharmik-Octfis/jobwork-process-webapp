-- Keep users.user_agent consistent: older rows are backfilled, and new rows
-- must never store NULL again.
UPDATE "users"
SET "user_agent" = 'unknown'
WHERE "user_agent" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "user_agent" SET DEFAULT 'unknown',
ALTER COLUMN "user_agent" SET NOT NULL;
