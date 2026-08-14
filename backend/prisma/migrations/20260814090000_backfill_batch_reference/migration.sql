-- Backfill `supplier_batch_ref` for batch-tracked items.
--
-- From 2026-08-14 `batch_number` is an internal key only: never rendered, never
-- printed, never searched (it is this system's equivalent of Zoho's hidden record
-- id). The label a user sees and picks by is `supplier_batch_ref`, and
-- `createBatch` now refuses to create a batch-tracked batch without one.
--
-- Rows created before that rule have NULL, and would render as a blank row in the
-- issue picker once `batch_number` comes off the screen. `batch_number` is the
-- only label these rows have ever had, so it is the only honest thing to seed
-- them with -- a one-off for existing data, not an ongoing fallback.
--
-- Scoped to batch-tracked items on purpose. An untracked item's batches are ledger
-- plumbing that is never listed, never picked and never printed, so a label for
-- them would be noise; `createBatch` does not require one either.
--
-- Data-only, so it is hand-written: `migrate diff` compares schema and would
-- generate nothing here. No constraint is added -- whether the reference is
-- required depends on `items.inventory_tracking`, which a CHECK on `batches`
-- cannot see, so `createBatch` stays the single enforcement point.
UPDATE batches AS b
SET supplier_batch_ref = b.batch_number
FROM items AS i
WHERE i.id = b.item_id
  AND i.inventory_tracking = 'batch'
  AND b.supplier_batch_ref IS NULL;
