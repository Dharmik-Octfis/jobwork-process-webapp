-- add_session_lifecycle_columns
--
-- Turn `refresh_tokens` from an ephemeral token store into a session record that
-- survives the session, so "when and how often did this user log in, and from
-- what" can be answered. Paired with the removal of token rotation — see the
-- model comment in prisma/schema/tenant.prisma and docs/AUTHENTICATION.md §4.4.
--
-- Purely additive: four nullable columns and one index. No statement here
-- destroys or rewrites an existing value, so it is safe on a live database and
-- needs no @destructive-ok acknowledgement.
--
-- 🔴 `migrate diff` also emitted the pending `memberships` → `users` personal
-- details move (10 DROP COLUMNs) and the `organizations.org_code` unique index,
-- because the schema files and the database have drifted for that unrelated work
-- in progress. Those statements were removed by hand: they belong to the
-- 20260731100000_user_owns_personal_details draft, and carrying them here would
-- apply someone else's half-finished migration as a side effect of this one.
-- This file therefore does NOT close the whole drift, and `db:check-drift` will
-- still report the remainder until that draft is promoted.

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "last_used_at" TIMESTAMPTZ(6),
ADD COLUMN     "revoked_at" TIMESTAMPTZ(6),
ADD COLUMN     "revoked_reason" VARCHAR(32),
ADD COLUMN     "user_agent" TEXT;

-- CreateIndex
-- The live-session lookup (`revoked_at IS NULL`) on every refresh, and the
-- per-user history a report reads.
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");
