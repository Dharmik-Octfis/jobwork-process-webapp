-- restore_sso_identity_indexes
--
-- Re-creates the three indexes of 20260824064102_add_sso_identity_columns.
-- jobwork_dev records that migration as applied (2026-08-24) and still has its
-- columns, but on 2026-09-26 all three indexes were missing — dropped outside
-- prisma/migrations, cause unknown. `migrate deploy` never re-runs an applied
-- migration, so only a new one can put them back.
--
-- IF NOT EXISTS throughout: a database that kept them (or was rebuilt from
-- migrations) already has them, and this must be a no-op there.
--
-- The UNIQUE index is the one that matters: it is what stops two local users
-- being linked to the same accounts identity. jobwork_dev had 0 duplicate
-- identity_user_id values when this was written; if it fails with a duplicate
-- key, resolve the duplicate link first — never drop the UNIQUE to get past it.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_idp_session_id_idx" ON "refresh_tokens"("idp_session_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_idp_subject_idx" ON "refresh_tokens"("idp_subject");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_identity_user_id_key" ON "users"("identity_user_id");
