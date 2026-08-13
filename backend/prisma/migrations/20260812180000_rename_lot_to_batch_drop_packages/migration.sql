-- @destructive-ok: Package-level (per-taka) tracking is being removed end to end by
-- decision on 2026-08-12 — quantity granularity now stops at the batch. That drops
-- `lot_packages` (200 rows in dev) and the five columns that pointed at it, plus
-- `processes.preserves_packaging` and `job_receipts.mode`, which existed ONLY to
-- choose between unit-wise and bulk receipt and can no longer hold two values.
-- `items.lot_tracking` also goes: `inventory_tracking` becomes the single tracking
-- authority (spec I-4). Everything else in this file is a RENAME — no lot, ledger
-- row, challan line or genealogy array is touched.
--
-- 🔴 Written BY HAND. `migrate diff` renders every one of these renames as
-- DROP + ADD, which would have destroyed 33 batches, 495 ledger rows, 106 challan
-- lines and every `parent_lot_ids` array. Do not regenerate this file.

-- ---------------------------------------------------------------------------
-- 1. Package-level tracking — drop the referencing columns before the table, so
--    `lot_packages` has no inbound FK left when it goes.
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_ledger" DROP COLUMN IF EXISTS "lot_package_id";
ALTER TABLE "job_issue_lines" DROP COLUMN IF EXISTS "lot_package_id";
ALTER TABLE "item_assembly_lines" DROP COLUMN IF EXISTS "lot_package_id";
ALTER TABLE "job_receipt_outputs" DROP COLUMN IF EXISTS "parent_package_id";
ALTER TABLE "job_receipt_lines" DROP COLUMN IF EXISTS "parent_package_id";

-- Takes its RLS policy and its self-referencing genealogy FK with it.
DROP TABLE IF EXISTS "lot_packages";

-- The two flags that existed only to decide unit-wise vs bulk receipt.
ALTER TABLE "processes" DROP COLUMN IF EXISTS "preserves_packaging";
ALTER TABLE "job_receipts" DROP COLUMN IF EXISTS "mode";

-- ---------------------------------------------------------------------------
-- 2. Item tracking — collapse three columns onto two.
--
--    🔴 BACKFILL BEFORE THE DROP. `lot_tracking` is the only column that knows
--    which items were actually batch-tracked: 10 dev items sit at
--    'lot_and_package' while their `inventory_tracking` is NULL, so reading only
--    the UI column would silently downgrade them to untracked.
-- ---------------------------------------------------------------------------
UPDATE "items"
   SET "inventory_tracking" = CASE
         WHEN lower(coalesce("inventory_tracking", '')) = 'batch' THEN 'batch'
         WHEN "lot_tracking" IN ('lot', 'lot_and_package')        THEN 'batch'
         ELSE 'none'
       END;

-- An item cannot be batch-tracked and not stocked. The 10 rows promoted above
-- carry track_inventory = false today purely because no UI ever wrote it.
UPDATE "items" SET "track_inventory" = true WHERE "inventory_tracking" = 'batch';

ALTER TABLE "items" DROP COLUMN IF EXISTS "lot_tracking";

ALTER TABLE "items" ALTER COLUMN "inventory_tracking" TYPE VARCHAR(20);
ALTER TABLE "items" ALTER COLUMN "inventory_tracking" SET DEFAULT 'none';
ALTER TABLE "items" ALTER COLUMN "inventory_tracking" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. The rename. ALTER ... RENAME preserves every row, the RLS policy (it keys on
--    organization_id, not on the table name), and all grants.
-- ---------------------------------------------------------------------------
ALTER TABLE "lots" RENAME TO "batches";

ALTER TABLE "batches" RENAME COLUMN "lot_number" TO "batch_number";
ALTER TABLE "batches" RENAME COLUMN "supplier_lot_ref" TO "supplier_batch_ref";
ALTER TABLE "batches" RENAME COLUMN "parent_lot_ids" TO "parent_batch_ids";

ALTER TABLE "stock_ledger" RENAME COLUMN "lot_id" TO "batch_id";
ALTER TABLE "job_issue_lines" RENAME COLUMN "lot_id" TO "batch_id";
ALTER TABLE "item_assembly_lines" RENAME COLUMN "lot_id" TO "batch_id";
ALTER TABLE "item_assemblies" RENAME COLUMN "composite_lot_id" TO "composite_batch_id";
ALTER TABLE "job_receipts" RENAME COLUMN "output_lot_id" TO "output_batch_id";
ALTER TABLE "job_receipts" RENAME COLUMN "rework_lot_id" TO "rework_batch_id";
ALTER TABLE "job_receipt_outputs" RENAME COLUMN "output_lot_id" TO "output_batch_id";
ALTER TABLE "job_receipt_outputs" RENAME COLUMN "rework_lot_id" TO "rework_batch_id";
ALTER TABLE "processes" RENAME COLUMN "requires_single_lot" TO "requires_single_batch";

-- ---------------------------------------------------------------------------
-- 4. Index and constraint names.
--
--    🔴 RENAME TABLE does NOT rename them, and Prisma derives expected names from
--    the table + columns — leave these and `db:check-drift` reports drift forever
--    on a database that is actually correct.
--
--    Renaming the INDEX behind a PK/UNIQUE renames its constraint too; foreign
--    keys need RENAME CONSTRAINT. The sweep below catches every `lots_*` name on
--    the renamed table without this file having to enumerate them.
-- ---------------------------------------------------------------------------
ALTER INDEX "lots_pkey" RENAME TO "batches_pkey";
ALTER INDEX "lots_organization_id_lot_number_key" RENAME TO "batches_organization_id_batch_number_key";
ALTER INDEX "lots_organization_id_item_id_idx" RENAME TO "batches_organization_id_item_id_idx";

ALTER INDEX "stock_ledger_organization_id_item_id_lot_id_location_id_idx"
  RENAME TO "stock_ledger_organization_id_item_id_batch_id_location_id_idx";
ALTER INDEX "item_assembly_lines_organization_id_item_id_lot_id_idx"
  RENAME TO "item_assembly_lines_organization_id_item_id_batch_id_idx";

-- Every remaining constraint on the renamed table still carries the `lots_`
-- prefix — foreign keys and (Postgres 18) the named NOT NULL constraints.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"batches"'::regclass AND conname LIKE 'lots\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE "batches" RENAME CONSTRAINT %I TO %I',
      r.conname,
      'batches_' || substring(r.conname from 6)
    );
  END LOOP;
END $$;

-- Constraints on OTHER tables that name a renamed column.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.conrelid::regclass::text IN (
             'stock_ledger', 'job_issue_lines', 'item_assembly_lines',
             'item_assemblies', 'job_receipts', 'job_receipt_outputs', 'processes'
           )
       AND c.conname LIKE '%\_lot\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
      r.tbl, r.conname, replace(r.conname, '_lot_', '_batch_')
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Numbering.
--
--    🔴 `allocateNumber` reads the prefix from THIS ROW, not from the constant in
--    numberSequence.ts. Change the code alone and every org that has ever created
--    a lot keeps minting LOT-00042 forever. Existing LOT- values on existing
--    batches are deliberately left alone — renumbering would invalidate numbers
--    already printed on physical tags.
-- ---------------------------------------------------------------------------
UPDATE "number_sequences"
   SET "prefix" = 'BATCH-'
 WHERE "entity_type" = 'lot' AND "prefix" = 'LOT-';

UPDATE "number_sequences" SET "entity_type" = 'batch' WHERE "entity_type" = 'lot';
