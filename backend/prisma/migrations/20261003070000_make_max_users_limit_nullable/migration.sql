-- make_max_users_limit_nullable
--
-- NULL means "use ORGANIZATION_MAX_USERS_LIMIT" (constants/organization.ts). Both ALTERs are
-- no-ops where backend/fix-limit.ts already ran them by hand.
ALTER TABLE "organizations" ALTER COLUMN "max_users_limit" DROP NOT NULL;
ALTER TABLE "organizations" ALTER COLUMN "max_users_limit" DROP DEFAULT;

-- Nothing writes this column, so 10 can only be the old column default, not a chosen limit.
UPDATE "organizations" SET "max_users_limit" = NULL WHERE "max_users_limit" = 10;
