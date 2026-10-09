-- add_zoho_foreign_keys
--
-- 20260930180000_add_zoho_integrations declares these FKs inline, but where
-- the tables already existed its CREATE TABLE IF NOT EXISTS was a no-op and the
-- FKs never landed. Guarded on pg_constraint by name, and ON UPDATE NO ACTION
-- like the inline form, so a database built from migrations is untouched.

DO $$
DECLARE
  fk text[];
  -- {child table, column, parent table, ON DELETE}
  fks text[] := ARRAY[
    ['zoho_integrations', 'organization_id', 'organizations', 'CASCADE'],
    ['zoho_integrations', 'created_by',      'users',         'SET NULL'],
    ['zoho_integrations', 'updated_by',      'users',         'SET NULL'],
    ['oauth_states',      'organization_id', 'organizations', 'CASCADE'],
    ['oauth_states',      'user_id',         'users',         'CASCADE']
  ];
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = fk[1]::regclass AND conname = fk[1] || '_' || fk[2] || '_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE %s ON UPDATE NO ACTION',
        fk[1], fk[1] || '_' || fk[2] || '_fkey', fk[2], fk[3], fk[4]);
    END IF;
  END LOOP;
END $$;
