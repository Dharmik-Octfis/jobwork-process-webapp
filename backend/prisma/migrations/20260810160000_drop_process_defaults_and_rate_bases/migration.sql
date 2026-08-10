-- Processes: drop the two default-unit columns, and retire the `per_kg` and
-- `lump_sum` rate bases.
--
-- @destructive-ok: `processes.default_issue_uom_id` / `default_receive_uom_id`
-- are dropped because a step transacts in its ITEMS' stocking units (domain doc
-- §5.1). An org-wide default on the operation master was a guess about one item,
-- and it was applied in `jobOrders.service.ts` — which is how a challan and the
-- stock ledger could describe a single movement in two different units without
-- anything erroring. The item's own unit is the only correct answer, so these two
-- columns have no reader left. The UPDATEs below rewrite stored `per_kg` /
-- `lump_sum` to `per_issued_unit`: neither basis had a number this system holds
-- (there is no weight captured anywhere, and a lump sum billed in full against a
-- step that received nothing), and leaving the values in place would fall through
-- `processCharge`'s `default:` branch and silently bill ZERO on every affected
-- receipt. Rewriting is the smaller error and it is visible.
--
-- 🔴 `processes.custom_fields` is deliberately NOT dropped. `process` left
-- ENTITY_TYPES in the same change, so nothing writes it any more, but the column
-- is part of CLAUDE.md's default block for domain tables and any values an org
-- already saved stay readable instead of being destroyed.

-- Rate basis first, while the old values are still distinguishable.
UPDATE "processes"
SET "rate_basis" = 'per_issued_unit'
WHERE "rate_basis" IN ('per_kg', 'lump_sum');

-- Nullable on both step tables — a NULL means "inherit from the process", which
-- is still a valid answer and must be left alone.
UPDATE "route_steps"
SET "rate_basis" = 'per_issued_unit'
WHERE "rate_basis" IN ('per_kg', 'lump_sum');

UPDATE "job_order_steps"
SET "rate_basis" = 'per_issued_unit'
WHERE "rate_basis" IN ('per_kg', 'lump_sum');

-- The FKs go before the columns they sit on.
ALTER TABLE "processes" DROP CONSTRAINT IF EXISTS "processes_default_issue_uom_id_fkey";
ALTER TABLE "processes" DROP CONSTRAINT IF EXISTS "processes_default_receive_uom_id_fkey";

ALTER TABLE "processes" DROP COLUMN IF EXISTS "default_issue_uom_id";
ALTER TABLE "processes" DROP COLUMN IF EXISTS "default_receive_uom_id";
