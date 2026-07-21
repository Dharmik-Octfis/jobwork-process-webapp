-- ============================================================================
-- Geography redesign — states keyed by ISO 3166-2 code, cities anchored by a
-- geonames id, and organizations storing state_code + city_id instead of the old
-- free-text state/city name strings.
--
-- Data-preserving on purpose. The auto-generated diff would drop the columns and
-- re-add NOT NULL ones, which fails on the seeded reference rows and would wipe
-- any organization's address. Instead we add the new columns, backfill, then swap
-- the keys over — the same pattern as 20260720120200_industry_code.
--
--   states:  + code (ISO 3166-2) + country_code, backfilled for the seeded set,
--            then the primary key moves from id(uuid) to code and id is dropped.
--   cities:  + state_code (from the old state_id FK) + geonames_id (nullable —
--            NULL until a real dataset is imported); state_id is dropped.
--   orgs:    + state_code + city_id, backfilled from the old name text; an org
--            whose old state/city name matches no seeded row is left NULL (the
--            best that can be done for an unknown value). state + city dropped.
-- ============================================================================

-- 1. states: new columns, backfilled for the seeded set ----------------------
ALTER TABLE "states" ADD COLUMN "code" VARCHAR(6);
ALTER TABLE "states" ADD COLUMN "country_code" VARCHAR(2);

UPDATE "states" SET "code" = 'IN-GJ', "country_code" = 'IN' WHERE "name" = 'Gujarat';
UPDATE "states" SET "code" = 'IN-MH', "country_code" = 'IN' WHERE "name" = 'Maharashtra';

-- 2. cities: state_code (from state_id) + the geonames anchor -----------------
ALTER TABLE "cities" ADD COLUMN "state_code" VARCHAR(6);
ALTER TABLE "cities" ADD COLUMN "geonames_id" INTEGER;

UPDATE "cities" c SET "state_code" = s."code" FROM "states" s WHERE c."state_id" = s."id";

-- 3. organizations: state_code + city_id, backfilled from the name text -------
ALTER TABLE "organizations" ADD COLUMN "state_code" VARCHAR(6);
ALTER TABLE "organizations" ADD COLUMN "city_id" UUID;

UPDATE "organizations" o SET "state_code" = s."code"
  FROM "states" s WHERE o."state" = s."name";

UPDATE "organizations" o SET "city_id" = c."id"
  FROM "cities" c
  WHERE c."state_code" = o."state_code" AND c."name" = o."city";

-- 4. drop the old state/city keys and constraints ----------------------------
ALTER TABLE "cities" DROP CONSTRAINT "cities_state_id_fkey";
DROP INDEX "cities_name_state_id_key";
ALTER TABLE "states" DROP CONSTRAINT "states_pkey";
DROP INDEX "states_name_key";

-- 5. enforce NOT NULL on the new keys (a NULL here means an unknown value the
--    backfill could not map — fail loudly rather than persist bad reference data)
ALTER TABLE "states" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "states" ALTER COLUMN "country_code" SET NOT NULL;
ALTER TABLE "cities" ALTER COLUMN "state_code" SET NOT NULL;

-- 6. drop the now-unused old columns -----------------------------------------
ALTER TABLE "states" DROP COLUMN "id";
ALTER TABLE "cities" DROP COLUMN "state_id";
ALTER TABLE "organizations" DROP COLUMN "state";
ALTER TABLE "organizations" DROP COLUMN "city";

-- 7. new primary key + unique indexes ----------------------------------------
ALTER TABLE "states" ADD CONSTRAINT "states_pkey" PRIMARY KEY ("code");
CREATE UNIQUE INDEX "states_country_code_name_key" ON "states"("country_code", "name");
CREATE UNIQUE INDEX "cities_geonames_id_key" ON "cities"("geonames_id");
CREATE UNIQUE INDEX "cities_name_state_code_key" ON "cities"("name", "state_code");

-- 8. foreign keys ------------------------------------------------------------
ALTER TABLE "states" ADD CONSTRAINT "states_country_code_fkey"
  FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_code_fkey"
  FOREIGN KEY ("state_code") REFERENCES "states"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_state_code_fkey"
  FOREIGN KEY ("state_code") REFERENCES "states"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
