-- add_max_users_limit_to_organizations
--
ALTER TABLE "organizations" ADD COLUMN     "max_users_limit" INTEGER NOT NULL DEFAULT 10;

