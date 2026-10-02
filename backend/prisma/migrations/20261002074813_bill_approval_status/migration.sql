-- bill_approval_status
--
-- docs/BILL_APPROVAL_GATE_PLAN.md §5. A bill's `status` stays Draft | Open and
-- means only "has it posted"; where its approval stands lives here.
--
-- No backfill: on 2026-10-02 neither jobwork_local nor jobwork_dev held a bill
-- whose status the approval engine had overwritten (§6's query, zero rows on both).
--
-- Trimmed by hand to this one statement: `db:draft` also proposed dropping
-- unrelated drift on this database (the approval tables), which is not this
-- change's to touch.

ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "approval_status" VARCHAR(20);
