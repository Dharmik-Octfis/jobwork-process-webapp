-- @destructive-ok: Removes two duplicate stores of quantity that the ledger already
-- holds, per the 2026-08-13 review. `item_location_stocks` (2 dev rows) was a
-- per-item x per-location balance cache written by ONE screen and by no other
-- posting, so it was correct until the first job issue and silently wrong after;
-- and `item_opening_stock_rows.batches` (JSONB) was a second copy of rows that
-- already exist in `batches` — already diverged in dev, 3 elements against 10 real
-- batches. Both are re-derivable from `stock_ledger` + `batches`, which is what the
-- service now reads. Nothing else in this file loses data: the five batch
-- attributes are MOVED out of JSONB into typed columns, and the two opening-stock
-- decimals are WIDENED.

-- ---------------------------------------------------------------------------
-- 1. Promote the five batch attributes out of `custom_fields` into real columns.
--
--    🔴 BACKFILL BEFORE THE KEYS ARE STRIPPED. All five are in live use in dev
--    (expiryDate, manufacturedDate, manufacturerBatch, mrp, sellingPrice) and the
--    JSONB is the only place they exist today.
-- ---------------------------------------------------------------------------
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "manufacturer_batch" VARCHAR(100);
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "manufactured_date" DATE;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "expiry_date" DATE;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(18, 4);
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "selling_price" DECIMAL(18, 4);

-- NULLIF('') guards the empty strings the form writes for untouched fields, which
-- would otherwise fail the ::date and ::numeric casts outright.
UPDATE "batches"
   SET "manufacturer_batch" = NULLIF(custom_fields ->> 'manufacturerBatch', ''),
       "manufactured_date"  = NULLIF(custom_fields ->> 'manufacturedDate', '')::date,
       "expiry_date"        = NULLIF(custom_fields ->> 'expiryDate', '')::date,
       "mrp"                = NULLIF(custom_fields ->> 'mrp', '')::numeric,
       "selling_price"      = NULLIF(custom_fields ->> 'sellingPrice', '')::numeric
 WHERE custom_fields ?| ARRAY['manufacturerBatch', 'manufacturedDate', 'expiryDate', 'mrp', 'sellingPrice'];

-- `custom_fields` goes back to meaning only what it is for: per-org dynamic fields.
UPDATE "batches"
   SET "custom_fields" = custom_fields
         - 'manufacturerBatch' - 'manufacturedDate' - 'expiryDate' - 'mrp' - 'sellingPrice'
 WHERE custom_fields ?| ARRAY['manufacturerBatch', 'manufacturedDate', 'expiryDate', 'mrp', 'sellingPrice'];

CREATE INDEX IF NOT EXISTS "batches_organization_id_expiry_date_idx"
  ON "batches" ("organization_id", "expiry_date");

-- ---------------------------------------------------------------------------
-- 2. The opening-stock document keeps only what it declares.
--
--    Widen FIRST, then drop. (18,4) matches `stock_ledger.qty_in`; at (10,2) a
--    quantity the ledger held as 12.3456 read back from here as 12.35.
-- ---------------------------------------------------------------------------
ALTER TABLE "item_opening_stock_rows"
  ALTER COLUMN "opening_stock" TYPE DECIMAL(18, 4),
  ALTER COLUMN "opening_stock_value_per_unit" TYPE DECIMAL(18, 4);

ALTER TABLE "item_opening_stock_rows" DROP COLUMN IF EXISTS "batches";

-- ---------------------------------------------------------------------------
-- 3. The balance cache nobody maintained. Takes its RLS policy with it.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "item_location_stocks";
