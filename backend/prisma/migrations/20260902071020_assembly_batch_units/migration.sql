-- assembly_batch_units
--
-- WHICH PACKAGE of a batch an assembly line consumed — a taka, roll or bale.
--
-- 🔴 A PACKAGE IS NOT ATOMIC HERE, unlike on a job issue, and the difference is
-- physical: an issue sends the roll to the processor so the whole roll travels,
-- while an assembly consumes material where it stands and cutting 20 m off a
-- 100 m roll is the ordinary case. The line keeps its own `qty`; this column just
-- says which roll that quantity came off.
--
-- Purely additive. Every existing line means "the untagged remainder", which is
-- what the new nullable column already says, so there is no backfill.
--
-- ⚠️ EDITED BY HAND from the `db:draft` output, as with the three migrations
-- before it. This database carries drift unrelated to this feature — three SSO
-- columns and two jobwork overview indexes live in the database under migrations
-- that are applied but missing from disk, and `db:status` lists all four. The
-- generated draft proposed DROPping them; every statement about them is removed.

-- AlterTable
ALTER TABLE "item_assembly_lines" ADD COLUMN "batch_unit_id" UUID;

-- AddForeignKey
ALTER TABLE "item_assembly_lines" ADD CONSTRAINT "item_assembly_lines_batch_unit_id_fkey" FOREIGN KEY ("batch_unit_id") REFERENCES "batch_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
