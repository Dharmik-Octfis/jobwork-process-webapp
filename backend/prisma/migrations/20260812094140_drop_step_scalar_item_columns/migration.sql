-- drop_step_scalar_item_columns
--
-- Migration B of the multi-item steps rollout (plan §12.1, step 9 — the last
-- remaining one). Steps 1–8 shipped; every reader and writer of these four
-- columns was removed first, so this only takes the columns themselves.
--
-- @destructive-ok: The four columns were a PROJECTION of `job_order_step_inputs`
-- / `job_order_step_outputs` (and the route equivalents) — the principal input
-- and the primary output, duplicated onto the step row so the pre-Sprint-5
-- client kept working during the rollout. Both clients now read the lists, and
-- nothing writes the scalars any more. Verified before drafting: `route_steps`
-- and `job_order_steps` hold 0 rows, and 0 rows exist where a scalar is set
-- without a matching child row, so no value is being destroyed.
--
-- 🔴 HAND-EDITED. `migrate diff` also emitted 14 statements belonging to the
-- composite-items feature, which is live in the database but absent from the
-- schema files — DROP TABLE on item_assembly_activities, item_assembly_comments,
-- item_location_stocks and item_opening_stock_rows, their foreign keys, an
-- item_assemblies default, and locations.is_primary. Every one of those is
-- pre-existing drift, not part of this change, and applying them would delete a
-- shipped feature. They were removed by hand. Any future draft against this
-- database will regenerate them — read the whole file before promoting.

-- DropForeignKey
ALTER TABLE "job_order_steps" DROP CONSTRAINT "job_order_steps_issue_item_id_fkey";

-- DropForeignKey
ALTER TABLE "job_order_steps" DROP CONSTRAINT "job_order_steps_issue_uom_id_fkey";

-- DropForeignKey
ALTER TABLE "job_order_steps" DROP CONSTRAINT "job_order_steps_receive_item_id_fkey";

-- DropForeignKey
ALTER TABLE "job_order_steps" DROP CONSTRAINT "job_order_steps_receive_uom_id_fkey";

-- DropForeignKey
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_issue_item_id_fkey";

-- DropForeignKey
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_issue_uom_id_fkey";

-- DropForeignKey
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_receive_item_id_fkey";

-- DropForeignKey
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_receive_uom_id_fkey";

-- AlterTable
ALTER TABLE "job_order_steps" DROP COLUMN "issue_item_id",
DROP COLUMN "issue_uom_id",
DROP COLUMN "receive_item_id",
DROP COLUMN "receive_uom_id";

-- AlterTable
ALTER TABLE "route_steps" DROP COLUMN "issue_item_id",
DROP COLUMN "issue_uom_id",
DROP COLUMN "receive_item_id",
DROP COLUMN "receive_uom_id";
