-- add_batch_search_trgm_index
--
-- Trigram indexes for the batch pickers' search.
--
-- 🔴 WHY GIN/TRIGRAM AND NOT A B-TREE. Every batch search in the app is an infix
-- match — `supplier_batch_ref ILIKE '%23%'` — because what people type is the
-- middle of what is printed on the physical tag. A b-tree can only serve a
-- prefix, so those queries are sequential scans however many b-trees exist.
--
-- 🔴 WHY NOW. Until 2026-08-22 the Receive dialog's "other batches of this item"
-- group answered a search only, so the scan ran once somebody had typed. It is
-- now listed by default and paged on scroll, so it runs on every plain open of
-- the dropdown, once per returned row. At 153 batches that is invisible; at a
-- hundred thousand it is the whole response time.
--
-- 🔴 WHAT WAS REMOVED FROM THE GENERATED DRAFT. `migrate diff` also emitted
-- DROP INDEX for `permission_templates_organization_id_name_key` and
-- `roles_organization_id_name_key`. Both are PRE-EXISTING drift and both were
-- deleted from this file by hand. The database has them as PARTIAL uniques
-- (`WHERE is_deleted = false`), which is the shape that lets a soft-deleted
-- role or template free its name for reuse — dropping them is a data hazard
-- and has nothing to do with this migration.

-- The operator class the two indexes below are built on. Not installed on this
-- database before now; `IF NOT EXISTS` because a migration is not transactional
-- here, so a re-run must not fail on the first statement.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "batches_supplier_batch_ref_idx" ON "batches" USING GIN ("supplier_batch_ref" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "batches_manufacturer_batch_idx" ON "batches" USING GIN ("manufacturer_batch" gin_trgm_ops);
