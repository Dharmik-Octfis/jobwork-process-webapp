-- add_org_code
--
-- Adds organizations.org_code: a ten-digit human-readable support code, shown
-- under the org name in the switcher so a customer can read it out to support
-- instead of spelling a uuid down a phone line.
--
-- It is NOT an identifier. Nothing joins on it, no URL contains it, and no
-- authorization decision reads it. organizations.id stays the PK and stays the
-- FK on every table that references an org.
--
-- Random rather than a sequence, so two customers comparing codes cannot infer
-- tenant count or signup order by subtraction.
--
-- VARCHAR rather than BIGINT: Prisma maps bigint to JS BigInt, and
-- JSON.stringify throws on BigInt, which would break every sendSuccess payload
-- carrying an organization. No arithmetic is ever done on this value.
--
-- Four steps, one migration. `organizations` holds one row per customer, so the
-- NOT NULL rewrite and the index build are instant at this size, and doing it
-- atomically means there is never a window where the column exists but nullable.
--
-- No DEFAULT, on purpose: the application supplies the code (crypto.randomInt),
-- so a write path that forgets fails loudly on NOT NULL rather than silently
-- receiving a database-generated value. Postgres random() appears only in the
-- one-time backfill below; the code is a displayed identifier, never a secret,
-- so a non-CSPRNG source is adequate there.
--
-- NOTE: `npm run db:draft` also emitted DROP COLUMN for currencies.exchange_rate
-- and organizations.website. Those are pre-existing drift, unrelated to this
-- change, and are deliberately NOT included here.

-- 1. Nullable to start — existing rows have no code yet.
ALTER TABLE "organizations" ADD COLUMN "org_code" VARCHAR(10);

-- 2. Backfill. Range 1000000000-9999999999, so every value is exactly ten
--    digits with no leading zero. The inner loop re-rolls on collision; the
--    index in step 3 is what actually makes duplicates impossible.
DO $$
DECLARE
  target_id uuid;
  candidate text;
BEGIN
  FOR target_id IN SELECT id FROM organizations WHERE org_code IS NULL LOOP
    LOOP
      candidate := (floor(random() * 9000000000) + 1000000000)::bigint::text;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM organizations WHERE org_code = candidate);
    END LOOP;
    UPDATE organizations SET org_code = candidate WHERE id = target_id;
  END LOOP;
END $$;

-- 3. The guarantee. Deliberately a full unique index, not a partial one with
--    `WHERE is_deleted = false`: a soft-deleted org must keep occupying its
--    code, so an old code read out to support still traces to the right row.
CREATE UNIQUE INDEX "organizations_org_code_key" ON "organizations"("org_code");

-- 4. Every row has a code now, and the application supplies one on every insert.
ALTER TABLE "organizations" ALTER COLUMN "org_code" SET NOT NULL;
