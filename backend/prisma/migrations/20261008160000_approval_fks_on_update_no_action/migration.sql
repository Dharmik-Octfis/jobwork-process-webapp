-- approval_fks_on_update_no_action
--
-- 20261008140000_add_approval_foreign_keys created its FKs ON UPDATE CASCADE,
-- but the inline FKs of 20260918110000 — what a database built from
-- migrations has — are ON UPDATE NO ACTION. Bring the former into line. Ids
-- are never updated, so behaviour does not change.
--
-- Drop and add in ONE statement per FK, so the table is never left without
-- it; FKs already NO ACTION ('a') are skipped.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confupdtype <> 'a'
      AND c.conrelid::regclass::text LIKE 'approval\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT %I, ADD CONSTRAINT %I %s',
      r.tbl, r.conname, r.conname, replace(r.def, ' ON UPDATE CASCADE', ''));
  END LOOP;
END $$;
