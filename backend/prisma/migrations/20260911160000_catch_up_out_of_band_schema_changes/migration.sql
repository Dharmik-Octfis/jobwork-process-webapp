-- catch_up_out_of_band_schema_changes
--
-- THE LAST GAP BETWEEN `prisma/migrations` AND THE SCHEMA FILES. With the five
-- missing tables restored (20260819085000) and the unreplayable index migration
-- replaced (20260824054200), the history finally applies to an empty database —
-- but the result still did not MATCH the schema. This closes that, and it was
-- written from `migrate diff` output taken against a database actually rebuilt
-- from the migrations, not from reading the schema and guessing.
--
-- Everything here is another `db push` residue: changes made straight to the
-- shared database, so the schema files and the live database agree while
-- `prisma/migrations` never heard about any of it.
--
-- 🔴 EVERY STATEMENT IS A NO-OP ON A DATABASE THAT ALREADY MATCHES, and that is
-- not politeness — it is what makes this file safe to exist. `migrate diff`
-- renders a RENAME as drop-plus-add and a TYPE CHANGE as drop-plus-add, and
-- applied literally against the live database this file would have destroyed
-- `vendors.notes`, `customers.notes` and all three `items` image columns. So the
-- renames and the type changes are guarded on `information_schema`, and the adds
-- and drops carry `IF [NOT] EXISTS`. Verified both ways: replayed onto an empty
-- database it produces an exact match, and applied to the live database it
-- changes nothing.
--
-- Migrations here are not transactional, so each statement has to stand alone.

-- 1. Columns added out-of-band ------------------------------------------------
ALTER TABLE "bills"          ADD COLUMN IF NOT EXISTS "payment_terms" VARCHAR(100);

ALTER TABLE "currencies"     ADD COLUMN IF NOT EXISTS "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
                             ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "items"          ADD COLUMN IF NOT EXISTS "opening_stock" DECIMAL(10,2),
                             ADD COLUMN IF NOT EXISTS "opening_stock_value_per_unit" DECIMAL(10,2),
                             ADD COLUMN IF NOT EXISTS "purchase_description" TEXT,
                             ADD COLUMN IF NOT EXISTS "sales_description" TEXT;

ALTER TABLE "organizations"  ADD COLUMN IF NOT EXISTS "logo_url" TEXT,
                             ADD COLUMN IF NOT EXISTS "website" TEXT;

ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
                             ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
                             ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

ALTER TABLE "users"          ADD COLUMN IF NOT EXISTS "ip_address" TEXT,
                             ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
                             ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

-- 2. `remarks` -> `notes`, a RENAME and not a drop-plus-add -------------------
-- `migrate diff` cannot see intent, so it proposed DROP "remarks" + ADD "notes",
-- which on the live database would have thrown every vendor's and customer's
-- notes away. RENAME moves the data; the guard makes it a no-op where it has
-- already happened.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'vendors' AND column_name = 'remarks')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'vendors' AND column_name = 'notes') THEN
    ALTER TABLE "vendors" RENAME COLUMN "remarks" TO "notes";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'remarks')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'notes') THEN
    ALTER TABLE "customers" RENAME COLUMN "remarks" TO "notes";
  END IF;
END $$;

-- 3. The three `items` image columns became JSONB ----------------------------
-- Migrations create `front_image`/`rear_image` as TEXT and `images` as TEXT[];
-- the schema wants JSONB. Guarded on the current type, so this only runs on a
-- database still carrying the old shape — where `items` is empty, which is why
-- the USING casts cannot fail. `images` comes from an array, so `to_jsonb` is
-- the correct cast rather than a text parse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'items'
                AND column_name = 'front_image' AND data_type <> 'jsonb') THEN
    ALTER TABLE "items" ALTER COLUMN "front_image" TYPE JSONB USING NULLIF("front_image", '')::jsonb;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'items'
                AND column_name = 'rear_image' AND data_type <> 'jsonb') THEN
    ALTER TABLE "items" ALTER COLUMN "rear_image" TYPE JSONB USING NULLIF("rear_image", '')::jsonb;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'items'
                AND column_name = 'images' AND data_type <> 'jsonb') THEN
    ALTER TABLE "items" ALTER COLUMN "images" TYPE JSONB USING to_jsonb("images");
    ALTER TABLE "items" ALTER COLUMN "images" SET DEFAULT '[]';
  END IF;
END $$;

-- 4. Defaults and nullability ------------------------------------------------
-- All four are naturally idempotent: setting a default that is already set, or
-- dropping a NOT NULL that is already absent, both succeed silently.
ALTER TABLE "items" ALTER COLUMN "item_type" SET DEFAULT 'goods';
ALTER TABLE "items" ALTER COLUMN "item_structure" SET DEFAULT 'single';
ALTER TABLE "users" ALTER COLUMN "user_agent" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "user_agent" DROP DEFAULT;

-- 5. Columns the schema no longer has ----------------------------------------
-- @destructive-ok: these ten columns exist ONLY in a database rebuilt from
-- prisma/migrations. Every real environment had them removed out-of-band long
-- ago (which is why `db:check-drift` does not mention them), and a database
-- fresh enough to still carry them has no rows in `items` to lose. Verified: the
-- scratch rebuild reported 0 items, the live database 107 and none of these
-- columns.
ALTER TABLE "items" DROP COLUMN IF EXISTS "alias_name",
                    DROP COLUMN IF EXISTS "bin_location_tracking",
                    DROP COLUMN IF EXISTS "brand",
                    DROP COLUMN IF EXISTS "delivery_date",
                    DROP COLUMN IF EXISTS "inventory_account",
                    DROP COLUMN IF EXISTS "inventory_valuation_method",
                    DROP COLUMN IF EXISTS "manufacturer",
                    DROP COLUMN IF EXISTS "purchase_account",
                    DROP COLUMN IF EXISTS "sales_account",
                    DROP COLUMN IF EXISTS "tax_preference";

-- 6. The unique index on org_code --------------------------------------------
-- `Organization.orgCode` is `@unique` in the schema. A rebuild without this
-- accepts two organizations sharing an org code — a missing UNIQUE fails open.
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_org_code_key" ON "organizations"("org_code");

-- 7. The two `locations` audit foreign keys ----------------------------------
-- `ADD CONSTRAINT` has no `IF NOT EXISTS`, hence the guards.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_created_by_fkey'
                   AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "locations" ADD CONSTRAINT "locations_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_updated_by_fkey'
                   AND connamespace = 'public'::regnamespace) THEN
    ALTER TABLE "locations" ADD CONSTRAINT "locations_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
