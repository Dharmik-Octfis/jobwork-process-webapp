-- Personal details move from `memberships` to `users`.
--
-- 20260730120000_per_org_member_profiles put the whole employee record on the
-- membership: name AND phone, mobile, date of birth, address, avatar. That was too
-- much. Only the NAME legitimately differs per organization; a person has one date
-- of birth, and a per-org copy invites two organizations holding contradictory
-- values with no way to say which is current. So `users` becomes the single source
-- of truth for everything except the display name.
--
-- 🔴 Consequence, deliberately accepted: an admin in one organization editing a
-- phone number or address changes what EVERY organization that person belongs to
-- sees. That is what a single source of truth means. The UI labels these fields as
-- shared so nobody edits them believing they are org-local.
--
-- What STAYS on memberships: first_name, last_name, full_name (per-org display
-- name), is_active (per-org deactivation), custom_fields (per-org field values —
-- see step 4 for why that one cannot move), role_id, permission_template_id,
-- is_owner.
--
-- @destructive-ok: nothing to destroy. Checked against jobwork_dev on 2026-07-31 —
-- 7 membership rows, 0 with any of these columns set; they were created empty by
-- 20260730120000 the day before and never written to. Step 2 copies any values that
-- do exist into `users` before step 4 drops the columns, so the migration is
-- non-destructive even where that count is not zero (staging, production). Re-run
-- the BEFORE query at the bottom on each environment prior to applying.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. users gains the personal details. `avatar_url` already exists there.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN "phone"         VARCHAR(20),
  ADD COLUMN "mobile"        VARCHAR(20),
  ADD COLUMN "date_of_birth" DATE,
  ADD COLUMN "address_line1" VARCHAR(255),
  ADD COLUMN "address_line2" VARCHAR(255),
  ADD COLUMN "city_id"       UUID,
  ADD COLUMN "state_code"    VARCHAR(6),
  ADD COLUMN "country_code"  VARCHAR(2),
  ADD COLUMN "zip"           VARCHAR(20),
  ADD COLUMN "avatar_url"    TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Copy anything already entered, so the DROP below destroys nothing.
--
--    A user can belong to several organizations, so there can be several candidate
--    rows. `DISTINCT ON (user_id) … ORDER BY user_id, updated_at DESC` picks the
--    most recently touched membership that actually has a value — the best
--    available answer to "which copy is current?", and deterministic rather than
--    whichever row the planner happened to return.
--
--    COALESCE keeps any value already on `users` (there is none today — the columns
--    were created empty in step 1 — but it makes re-running this harmless).
-- ────────────────────────────────────────────────────────────────────────────

UPDATE "users" u
SET
  "phone"         = COALESCE(u."phone",         m."phone"),
  "mobile"        = COALESCE(u."mobile",        m."mobile"),
  "date_of_birth" = COALESCE(u."date_of_birth", m."date_of_birth"),
  "address_line1" = COALESCE(u."address_line1", m."address_line1"),
  "address_line2" = COALESCE(u."address_line2", m."address_line2"),
  "city_id"       = COALESCE(u."city_id",       m."city_id"),
  "state_code"    = COALESCE(u."state_code",    m."state_code"),
  "country_code"  = COALESCE(u."country_code",  m."country_code"),
  "zip"           = COALESCE(u."zip",           m."zip"),
  "avatar_url"    = COALESCE(u."avatar_url",    m."avatar_url")
FROM (
  SELECT DISTINCT ON ("user_id")
    "user_id", "phone", "mobile", "date_of_birth", "address_line1", "address_line2",
    "city_id", "state_code", "country_code", "zip", "avatar_url"
  FROM "memberships"
  WHERE "phone" IS NOT NULL OR "mobile" IS NOT NULL OR "date_of_birth" IS NOT NULL
     OR "address_line1" IS NOT NULL OR "address_line2" IS NOT NULL OR "city_id" IS NOT NULL
     OR "state_code" IS NOT NULL OR "country_code" IS NOT NULL OR "zip" IS NOT NULL
     OR "avatar_url" IS NOT NULL
  ORDER BY "user_id", "updated_at" DESC
) m
WHERE m."user_id" = u."id";

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Address FKs on users, mirroring `organizations` exactly.
--
--    ON DELETE SET NULL, not RESTRICT: the relations declare no `onDelete` in the
--    schema, so Prisma infers SET NULL for an optional relation. Writing RESTRICT
--    would work in Postgres and then leave `db:check-drift` red forever.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "users"
  ADD CONSTRAINT "users_city_id_fkey"
    FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "users_state_code_fkey"
    FOREIGN KEY ("state_code") REFERENCES "states"("code") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "users_country_code_fkey"
    FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Drop the per-org copies. Their FK constraints go with the columns —
--    Postgres drops constraints that depend on a dropped column automatically.
--
--    🔴 `custom_fields` is NOT dropped, and the difference is not a preference.
--    Custom-field DEFINITIONS are per-organization, so org A's "Employee Code" and
--    org B's "Shift" are different fields that happen to describe the same person.
--    Moving their VALUES onto the shared `users` row would put both organizations'
--    data in one JSONB blob and let each read the other's — a cross-tenant leak.
--    Per-org values belong on the per-org row.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "memberships"
  DROP COLUMN "avatar_url",
  DROP COLUMN "phone",
  DROP COLUMN "mobile",
  DROP COLUMN "date_of_birth",
  DROP COLUMN "address_line1",
  DROP COLUMN "address_line2",
  DROP COLUMN "city_id",
  DROP COLUMN "state_code",
  DROP COLUMN "country_code",
  DROP COLUMN "zip";

-- ────────────────────────────────────────────────────────────────────────────
-- Verification.
--
-- BEFORE applying — how much data step 2 has to carry. Zero means the drop is
-- trivially safe; non-zero means step 2 is doing real work and step 4 is only
-- removing a copy:
--
--   SELECT count(*) FROM memberships
--   WHERE phone IS NOT NULL OR mobile IS NOT NULL OR date_of_birth IS NOT NULL
--      OR address_line1 IS NOT NULL OR address_line2 IS NOT NULL OR city_id IS NOT NULL
--      OR state_code IS NOT NULL OR country_code IS NOT NULL OR zip IS NOT NULL
--      OR avatar_url IS NOT NULL;
--
-- AFTER applying — every user who had a detail on any membership now has it on
-- their account. Run the count above first and keep the number; this should not be
-- smaller:
--
--   SELECT count(*) FROM users
--   WHERE phone IS NOT NULL OR mobile IS NOT NULL OR date_of_birth IS NOT NULL
--      OR address_line1 IS NOT NULL OR address_line2 IS NOT NULL OR city_id IS NOT NULL
--      OR state_code IS NOT NULL OR country_code IS NOT NULL OR zip IS NOT NULL;
