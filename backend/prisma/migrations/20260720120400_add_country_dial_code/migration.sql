-- Country.dialCode: the ITU calling-code prefix ("+91") the phone-number dropdown
-- binds to. Previously the country list (with its dial codes) was hardcoded in
-- master-data.controller.ts; it now comes from this table, so the prefix needs a
-- home here.
--
-- Data-preserving on purpose. The `countries` table already holds the seeded
-- reference rows, so the auto-generated diff (ADD COLUMN ... NOT NULL with no
-- default) would fail on them. Instead:
--   * add the column nullable,
--   * backfill each seeded country by its ISO 3166-1 alpha-2 `code`,
--   * then enforce NOT NULL.
-- `dial_code` is NOT unique — the US and Canada both share "+1". A row left with
-- no value blocks the NOT NULL step, which is intended: a country with no dial
-- code is bad reference data. See seed.ts for the authoritative list.

ALTER TABLE "countries" ADD COLUMN "dial_code" VARCHAR(8);

UPDATE "countries" SET "dial_code" = CASE "code"
  WHEN 'IN' THEN '+91'
  WHEN 'US' THEN '+1'
  WHEN 'GB' THEN '+44'
  WHEN 'AE' THEN '+971'
  WHEN 'SG' THEN '+65'
  WHEN 'AU' THEN '+61'
  WHEN 'CA' THEN '+1'
  WHEN 'DE' THEN '+49'
END
WHERE "code" IN ('IN', 'US', 'GB', 'AE', 'SG', 'AU', 'CA', 'DE');

ALTER TABLE "countries" ALTER COLUMN "dial_code" SET NOT NULL;
