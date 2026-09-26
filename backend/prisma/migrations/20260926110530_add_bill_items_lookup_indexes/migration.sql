-- add_bill_items_lookup_indexes
--
-- The two `bill_items` indexes declared in purchases.prisma by 51f46fd (stock
-- summary / movement reports, 2026-09-22), which shipped with no migration — so
-- no database had them and `db:check-drift` reported them on every run. A draft
-- for them was started and abandoned as 20260922080045_add_bill_items_indexes.sql.bak.
--
-- IF NOT EXISTS so a database where someone already created them by hand, or a
-- later migration for the same indexes, is a no-op rather than a failure.
-- Plain (not CONCURRENTLY): bill_items was 150 rows on jobwork_dev, so the write
-- lock lasts milliseconds.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_items_bill_id_item_id_idx" ON "bill_items"("bill_id", "item_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bill_items_job_receipt_id_item_id_idx" ON "bill_items"("job_receipt_id", "item_id");
