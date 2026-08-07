-- job_order_header_items_optional
--
-- The job order header no longer names ONE item and ONE quantity.
--
-- A step consumes a SET of items (domain §5.7), so a single pair on the header
-- could only ever describe one of them — and naming one of three on the document
-- that owns all three is worse than naming none. The create form dropped both
-- fields; the service now DERIVES these columns from step 1's first consumed row
-- so the list page still has something to show and existing orders keep reading.
--
-- Nullable, because a step that lists no inputs yet has nothing to derive from
-- and a required column would force a value to be invented.
--
-- 🔴 No data is lost: every existing row keeps its item and quantity. What stops
-- being enforced is "every job order must name an item", which is exactly the
-- rule being retired.
--
-- ⚠️ The foreign key is dropped and re-added because the relation became
-- optional: it changes from ON DELETE RESTRICT to ON DELETE SET NULL. Items are
-- soft-deleted everywhere in this codebase, so a hard delete that could trigger
-- it happens only in tests.
--
-- 🔴 TWO `DROP INDEX` STATEMENTS WERE REMOVED FROM THIS DRAFT BY HAND — the same
-- pair stripped from 20260806112805_multi_item_steps and 20260807050131, for the
-- same reason.
--
-- `migrate diff` wanted to drop `permission_templates_organization_id_name_key`
-- and `roles_organization_id_name_key`. Those are the PARTIAL unique indexes
-- shipped on 2026-08-05 (migrations 20260805130000 and 20260805133000). Prisma
-- cannot express a partial index, so its `@@unique` renders as the plain one and
-- EVERY future draft keeps asking to "fix" the difference. Applying it would
-- silently undo the soft-delete-aware uniqueness those migrations exist for.
--
-- Strip them from every future draft too. `db:check-drift` reports this as
-- permanent drift, and that drift is correct.

-- DropForeignKey
ALTER TABLE "job_orders" DROP CONSTRAINT "job_orders_input_item_id_fkey";

-- AlterTable
ALTER TABLE "job_orders" ALTER COLUMN "input_item_id" DROP NOT NULL,
ALTER COLUMN "input_qty" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_input_item_id_fkey" FOREIGN KEY ("input_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
