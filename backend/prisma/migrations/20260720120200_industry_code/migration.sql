-- Industries are now referenced by a stable, space-free `code` (Organization
-- .industryCode -> Industry.code) instead of by the display name stored as loose
-- text. A code survives renaming the label and never carries spaces/punctuation
-- into reports, URLs, or grouping. See seed.ts for the authoritative code list.
--
-- Data-preserving on purpose (the auto-generated diff would drop the column and
-- add a NOT NULL one, which fails on the seeded industry rows):
--   * industries.code is backfilled by slugifying the existing name, which for
--     the seeded set ("Technology" -> "technology", ...) equals the seed codes.
--   * organizations.industry_code is backfilled by matching the old
--     industry_type text against industries.name.

-- 1. industries.code: add, backfill from name, then enforce NOT NULL + UNIQUE ---
ALTER TABLE "industries" ADD COLUMN "code" VARCHAR(64);

UPDATE "industries"
  SET "code" = regexp_replace(
                 regexp_replace(lower(btrim("name")), '[^a-z0-9]+', '_', 'g'),
                 '^_+|_+$', '', 'g');

ALTER TABLE "industries" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "industries_code_key" ON "industries"("code");

-- 2. organizations: replace the industry_type name-text with an industry_code FK -
ALTER TABLE "organizations" ADD COLUMN "industry_code" VARCHAR(64);

UPDATE "organizations" o
  SET "industry_code" = i."code"
  FROM "industries" i
  WHERE o."industry_type" = i."name";

ALTER TABLE "organizations" DROP COLUMN "industry_type";

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_industry_code_fkey"
  FOREIGN KEY ("industry_code") REFERENCES "industries"("code")
  ON DELETE SET NULL ON UPDATE CASCADE;
