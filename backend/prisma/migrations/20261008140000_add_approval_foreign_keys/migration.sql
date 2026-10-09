-- add_approval_foreign_keys
--
-- 20260918110000_create_approval_process_tables declares every approval FK
-- inline, but on databases where the tables already existed its
-- CREATE TABLE IF NOT EXISTS was a no-op, so those databases have no FKs and
-- tenants hard-deleted since then left rows behind. Before each FK is added,
-- the rows it would reject get what its ON DELETE rule would have done:
-- CASCADE deletes the row, SET NULL clears the reference. A database built
-- from migrations already has these FKs and no such rows, so it is a no-op there.
--
-- @destructive-ok: removes only rows whose organization/parent no longer exists (unreachable through tenantContext); nulls dangling user refs as ON DELETE SET NULL would have
--
-- Guarded on pg_constraint by name, so an existing inline FK is left as it is.
-- Every step is idempotent — migrations here are not transactional.

DO $$
DECLARE
  fk text[];
  -- {child table, column, parent table, ON DELETE} — parents before children,
  -- so a row removed by an earlier step is already gone when its children are checked
  fks text[] := ARRAY[
    ['approval_processes',         'organization_id',    'organizations',             'CASCADE'],
    ['approval_processes',         'created_by',         'users',                     'SET NULL'],
    ['approval_processes',         'updated_by',         'users',                     'SET NULL'],
    ['approval_process_versions',  'organization_id',    'organizations',             'CASCADE'],
    ['approval_process_versions',  'process_id',         'approval_processes',        'CASCADE'],
    ['approval_process_versions',  'created_by',         'users',                     'SET NULL'],
    ['approval_process_rules',     'organization_id',    'organizations',             'CASCADE'],
    ['approval_process_rules',     'process_id',         'approval_processes',        'CASCADE'],
    ['approval_process_rules',     'created_by',         'users',                     'SET NULL'],
    ['approval_process_rules',     'updated_by',         'users',                     'SET NULL'],
    ['approval_stages',            'organization_id',    'organizations',             'CASCADE'],
    ['approval_stages',            'rule_id',            'approval_process_rules',    'CASCADE'],
    ['approval_stages',            'created_by',         'users',                     'SET NULL'],
    ['approval_stages',            'updated_by',         'users',                     'SET NULL'],
    ['approval_actions',           'organization_id',    'organizations',             'CASCADE'],
    ['approval_actions',           'rule_id',            'approval_process_rules',    'CASCADE'],
    ['approval_actions',           'stage_id',           'approval_stages',           'CASCADE'],
    ['approval_actions',           'created_by',         'users',                     'SET NULL'],
    ['approval_actions',           'updated_by',         'users',                     'SET NULL'],
    ['approval_process_admins',    'organization_id',    'organizations',             'CASCADE'],
    ['approval_process_admins',    'process_id',         'approval_processes',        'CASCADE'],
    ['approval_process_admins',    'user_id',            'users',                     'CASCADE'],
    ['approval_requests',          'organization_id',    'organizations',             'CASCADE'],
    ['approval_requests',          'process_id',         'approval_processes',        'CASCADE'],
    ['approval_requests',          'process_version_id', 'approval_process_versions', 'SET NULL'],
    ['approval_requests',          'rule_id',            'approval_process_rules',    'SET NULL'],
    ['approval_requests',          'current_stage_id',   'approval_stages',           'SET NULL'],
    ['approval_requests',          'requester_id',       'users',                     'SET NULL'],
    ['approval_requests',          'created_by',         'users',                     'SET NULL'],
    ['approval_requests',          'updated_by',         'users',                     'SET NULL'],
    ['approval_request_stages',    'organization_id',    'organizations',             'CASCADE'],
    ['approval_request_stages',    'request_id',         'approval_requests',         'CASCADE'],
    ['approval_request_stages',    'stage_id',           'approval_stages',           'SET NULL'],
    ['approval_request_approvers', 'organization_id',    'organizations',             'CASCADE'],
    ['approval_request_approvers', 'request_stage_id',   'approval_request_stages',   'CASCADE'],
    ['approval_request_approvers', 'user_id',            'users',                     'CASCADE'],
    ['approval_history',           'organization_id',    'organizations',             'CASCADE'],
    ['approval_history',           'request_id',         'approval_requests',         'CASCADE'],
    ['approval_history',           'actor_id',           'users',                     'SET NULL'],
    ['approval_action_executions', 'organization_id',    'organizations',             'CASCADE'],
    ['approval_action_executions', 'request_id',         'approval_requests',         'CASCADE'],
    ['approval_action_executions', 'action_id',          'approval_actions',          'SET NULL'],
    ['approval_notifications',     'organization_id',    'organizations',             'CASCADE'],
    ['approval_notifications',     'request_id',         'approval_requests',         'CASCADE'],
    ['approval_notifications',     'recipient_id',       'users',                     'CASCADE']
  ];
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fks LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = fk[1]::regclass AND conname = fk[1] || '_' || fk[2] || '_fkey'
    ) THEN
      CONTINUE;
    END IF;

    IF fk[4] = 'CASCADE' THEN
      EXECUTE format(
        'DELETE FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I)',
        fk[1], fk[2], fk[3], fk[2]);
    ELSE
      EXECUTE format(
        'UPDATE %I c SET %I = NULL WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I)',
        fk[1], fk[2], fk[2], fk[3], fk[2]);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE %s ON UPDATE CASCADE',
      fk[1], fk[1] || '_' || fk[2] || '_fkey', fk[2], fk[3], fk[4]);
  END LOOP;
END $$;

-- The migration's indexes. Databases that predate it carry two indexes from an
-- earlier schema draft instead, under different names and columns.
CREATE INDEX IF NOT EXISTS "idx_approval_requests_record" ON "approval_requests"("organization_id", "module_id", "record_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_requester" ON "approval_requests"("requester_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_process" ON "approval_requests"("process_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_request_stages_req" ON "approval_request_stages"("request_id", "stage_order");
CREATE INDEX IF NOT EXISTS "idx_approval_request_approvers_user" ON "approval_request_approvers"("user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_request_approvers_stage" ON "approval_request_approvers"("request_stage_id");

DROP INDEX IF EXISTS "idx_approval_req_stages_req";
DROP INDEX IF EXISTS "idx_approval_req_approvers_user";
