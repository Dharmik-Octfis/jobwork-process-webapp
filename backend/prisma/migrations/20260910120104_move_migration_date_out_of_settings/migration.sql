-- move_migration_date_out_of_settings
--
-- 🔴 HAND-WRITTEN, NOT DRAFTED — same as the three migrations before it.
-- `migrate diff` opens every draft with the three DROP COLUMNs for the live SSO
-- columns that the schema files have never heard of, because four applied
-- migrations are missing from prisma/migrations. This file carries no DDL.
--
-- ONE HOME FOR ONE VALUE. `settings.migrationDate` existed as a plain string
-- behind a date input on the Preferences page, with nothing on the server ever
-- reading it. The real anchor is now `organizations.migration_date`, added in
-- 20260910110828 — a column because it is a comparison operand every document
-- write evaluates, and because `settings` is shallow-merged by whichever form
-- last posted, so a page that does not render the key wipes it.
--
-- This carries across whatever anybody had already typed rather than making them
-- type it again, then removes the key so the two cannot drift apart.
--
-- 🔴 THE REGEX IS LOAD-BEARING. `::date` on a value that is not one raises, and
-- a failed statement in a migration leaves every statement before it applied —
-- these files are not transactional. Anything that is not YYYY-MM-DD is left
-- exactly where it is, in `settings`, for a human to look at.
--
-- `migration_date IS NULL` so this can never overwrite an anchor set through the
-- new column; the JSONB copy is only ever a fallback for one that was never set.
--
-- 🔴 WHAT THIS DELIBERATELY DOES NOT DO: re-date the opening stock. Adopting an
-- anchor should carry opening stock onto it — that is what `restampOpeningStock`
-- is for, and the update endpoint does exactly that. Doing it HERE would move
-- hundreds of posted ledger rows on the strength of a value that has never meant
-- anything until now, which is a bigger decision than consolidating two fields.
-- Re-saving the date on the Preferences page performs it, deliberately and
-- visibly, for whoever owns those books.

-- @destructive-ok: removes `settings.migrationDate` after copying it into
-- `organizations.migration_date`. The value survives in the column; only the
-- duplicate is dropped, and only for rows where the copy demonstrably landed.

UPDATE organizations
SET migration_date = (settings->>'migrationDate')::date,
    settings = settings - 'migrationDate'
WHERE settings ? 'migrationDate'
  AND settings->>'migrationDate' ~ '^\d{4}-\d{2}-\d{2}$'
  AND migration_date IS NULL;
