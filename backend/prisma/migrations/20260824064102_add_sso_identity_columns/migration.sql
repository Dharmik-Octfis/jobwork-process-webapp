-- add_sso_identity_columns
--
-- docs/SSO_AND_IDENTITY.md §13 step 3: the nullable columns that let a local user
-- be linked to a central identity, added ahead of the accounts service existing.
-- Nothing reads or writes them yet, and no code path changes.
--
-- Additive and reversible: three nullable columns, no default, no backfill, so
-- every existing row keeps working unchanged and a rollback is three DROPs.
--
-- `users_identity_user_id_key` is UNIQUE, and safe despite the generic ADD UNIQUE
-- warning: the column is brand new and entirely NULL, and Postgres treats NULLs as
-- distinct in a unique index, so there is nothing for it to collide on. It is what
-- stops two local users claiming one identity once linking begins (§9.2).
--
-- IF NOT EXISTS throughout because a migration here does not run in a transaction:
-- a statement that fails partway leaves the earlier ones applied, so the file has
-- to be safe to re-run.
--
-- Deliberately NOT included: the `bills_organization_id_bill_number_key` unique
-- index that `migrate diff` also offered. That is pre-existing drift in the other
-- direction — migration 20260824054127_remove_bill_unique_constraint dropped it
-- from the database and is missing from disk, so the schema file is the stale side.
-- Re-adding it here would silently revert someone else's deliberate change.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "idp_session_id" UUID,
ADD COLUMN IF NOT EXISTS "idp_subject" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identity_user_id" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_idp_session_id_idx" ON "refresh_tokens"("idp_session_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_idp_subject_idx" ON "refresh_tokens"("idp_subject");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_identity_user_id_key" ON "users"("identity_user_id");
