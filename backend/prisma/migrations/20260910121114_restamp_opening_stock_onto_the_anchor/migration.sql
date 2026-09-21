-- restamp_opening_stock_onto_the_anchor
--
-- 🔴 HAND-WRITTEN, NOT DRAFTED — as with the three before it, `migrate diff`
-- opens every draft with three DROP COLUMNs for the live SSO columns the schema
-- files have never heard of. This file carries no DDL.
--
-- FINISHES WHAT 20260910120104 DELIBERATELY LEFT HALF-DONE. That migration moved
-- the anchor out of `settings` into `organizations.migration_date` but did not
-- touch a single posted row, because re-dating hundreds of ledger entries on the
-- strength of a value that had never meant anything was a decision for whoever
-- owns those books, not a side effect of consolidating two fields. It has now
-- been made, so this is the other half.
--
-- WHY IT IS REQUIRED, NOT TIDYING. Opening stock is a statement about ONE
-- moment: what was here when the books began. Left on the day the figures were
-- typed, an organization asserts two different dates at once — OCTFIS TECHNO LLP
-- had an anchor of 09-Jun and 330 opening rows sitting between 11-Aug and
-- 08-Sep, so "stock as on 09-Jun" returned NOTHING AT ALL for a business whose
-- books supposedly began that day.
--
-- 🔴 IT ALSO UN-INVERTS THE LEDGER. Their job issues start 06-Aug and their
-- opening stock started 11-Aug — stock leaving five days before it arrived. Any
-- as-on report in that window read negative, and batch ageing measured from the
-- data-entry day rather than from the day the goods were actually there.
--
-- BOTH MOVEMENT TYPES. `settleOpening` writes a correction to an opening figure
-- as a `reversal` row against the same document, and a correction restates that
-- same moment rather than describing a second event today — see the note on its
-- `postedAt` argument. Re-dating the declaration without its corrections would
-- leave the anchor's balance overstated by every fix ever made to it.
--
-- QUANTITIES AND VALUES ARE UNTOUCHED. This moves dates only, so every current
-- balance is identical afterwards; that is the property to check if this is ever
-- questioned.
--
-- Written for whichever organizations carry an anchor rather than for one id:
-- today that is only the org whose value 20260910120104 carried across, and the
-- final predicate makes it a no-op for any anchor set through the update
-- endpoint, which already calls `restampOpeningStock` in the same transaction.

-- @destructive-ok: overwrites posted_at on opening-stock rows so they state the
-- day the books began rather than the day the figures were typed. Dates only —
-- no quantity or value changes — and `created_at` still records when each row
-- was actually written.

UPDATE stock_ledger sl
SET posted_at = (o.migration_date::timestamp AT TIME ZONE 'UTC')
FROM organizations o
WHERE o.id = sl.organization_id
  AND o.migration_date IS NOT NULL
  AND sl.source_doc_type = 'item_opening_stock'
  AND sl.posted_at <> (o.migration_date::timestamp AT TIME ZONE 'UTC');
