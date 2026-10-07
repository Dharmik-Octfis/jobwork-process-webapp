-- fix_sid_is_not_a_uuid
--
-- Corrects the session model, which 20260824073924_init_identity got wrong by
-- following docs/SSO_AND_IDENTITY.md §7.3 rather than the library.
--
-- §7.3 said "`SsoSession.id` is the `sid` claim", typed uuid. Both halves are wrong:
--
--   1. `sid` is PER CLIENT. `Session.sidFor(clientId)` keeps a separate value per
--      app under `authorizations[clientId].sid` — deliberate in OIDC, so two apps
--      cannot correlate the same user by comparing sids. One browser session has
--      one uid and as many sids as it has apps, so a sid cannot be the primary key
--      of a per-session table. `sid` moves to session_grants, which is already
--      per (session, client), and gains a unique index there because a back-channel
--      logout token names exactly one.
--   2. Neither uid nor sid is a uuid. Both are nanoid() — 43 characters of a
--      URL-safe alphabet. Verified against a real value: Postgres answers
--      `invalid input syntax for type uuid: "IT_N2JROOpH_hRKc-cRf4cAlV0Bejl0XkO3I5H9_UPD"`.
--      The original type would not have been caught at review; it would have failed
--      on the first SSO login.
--
-- Every ⚠️ below is moot here: both tables are empty, having never been written to.
-- On a populated database the same statements would be destructive — the NOT NULL
-- `sid` with no default would fail outright, and the uuid→varchar casts would need
-- checking. This is the one moment the change is free.
--
-- The matching correction to backend's refresh_tokens.idp_session_id ships
-- alongside; the two columns hold the same value and must agree.
-- DropForeignKey
-- ⚠️ REVIEW [DROP CONSTRAINT] no data is lost, but a rule that was being enforced stops being enforced
ALTER TABLE "session_grants" DROP CONSTRAINT "session_grants_session_id_fkey";

-- AlterTable
ALTER TABLE "session_grants" ADD COLUMN     "sid" VARCHAR(64) NOT NULL,
-- ⚠️ REVIEW [COLUMN TYPE CHANGE] an in-place cast can fail outright or silently truncate (varchar(n), numeric precision)
ALTER COLUMN "session_id" SET DATA TYPE VARCHAR(64);

-- AlterTable
-- ⚠️ REVIEW [DROP CONSTRAINT] no data is lost, but a rule that was being enforced stops being enforced
ALTER TABLE "sso_sessions" DROP CONSTRAINT "sso_sessions_pkey",
ALTER COLUMN "id" DROP DEFAULT,
-- ⚠️ REVIEW [COLUMN TYPE CHANGE] an in-place cast can fail outright or silently truncate (varchar(n), numeric precision)
ALTER COLUMN "id" SET DATA TYPE VARCHAR(64),
ADD CONSTRAINT "sso_sessions_pkey" PRIMARY KEY ("id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "session_grants_sid_key" ON "session_grants"("sid");

-- AddForeignKey
ALTER TABLE "session_grants" ADD CONSTRAINT "session_grants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sso_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
