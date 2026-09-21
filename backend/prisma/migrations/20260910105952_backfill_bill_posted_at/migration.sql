-- backfill_bill_posted_at
--
-- 🔴 HAND-WRITTEN, NOT DRAFTED. `migrate diff` would open this with the three
-- DROP COLUMNs on `refresh_tokens`/`users` that every draft picks up — they are
-- live SSO columns the schema files have never heard of, because four applied
-- migrations are missing from prisma/migrations. Applying them destroys every
-- SSO identity link. Same reasoning, and the same removal, as
-- 20260908075034_add_bill_item_batches. This file carries no DDL at all.
--
-- WHAT THIS FIXES. Until the commit that precedes this migration, all four of
-- the bill's posting sites omitted `postedAt` and fell through to
-- `postMovement`'s `new Date()`. A bill dated 15-Apr and entered in September
-- therefore put its stock on the books in September. The document always held
-- the right date; only the ledger disagreed with it.
--
-- The rows written since that commit are already correct, hence the final
-- predicate — this is a repair, not a rewrite.
--
-- 🔴 RECEIPTS ONLY. A `reversal` posts when the cancellation HAPPENED, which is
-- the day someone edited or cancelled the bill, not the day its goods arrived.
-- Re-dating those to `bill_date` would move a correction back into a period it
-- did not occur in and silently change every report already issued for it.
--
-- 🔴 UTC MIDNIGHT, matching exactly what Prisma now writes. `bill_date` is a
-- `date`; a bare `::timestamptz` cast would read it in the SESSION's timezone,
-- so the same bill would land on a different instant depending on who ran the
-- migration. `::timestamp AT TIME ZONE 'UTC'` pins it.
--
-- Runs as the owner, so RLS is bypassed and every tenant is repaired at once.

-- @destructive-ok: overwrites posted_at on bill receipt rows — that column is
-- what this repairs, the old value was the data-entry clock rather than the
-- date the goods arrived, and `created_at` still records when the row was
-- written. Not flagged by the analyser (a bare UPDATE matches no rule); the
-- acknowledgement is here so the reason lives in git.

UPDATE stock_ledger sl
SET posted_at = (b.bill_date::timestamp AT TIME ZONE 'UTC')
FROM bills b
WHERE sl.source_doc_id = b.id
  AND sl.source_doc_type = 'bill'
  AND sl.movement_type = 'receipt'
  AND sl.posted_at <> (b.bill_date::timestamp AT TIME ZONE 'UTC');
