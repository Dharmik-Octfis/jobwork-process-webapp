-- add_approval_process_admins_user_index
--
-- 20260918110000_create_approval_process_tables creates this index, but on
-- databases where the table already existed that step was skipped with the
-- rest of its CREATE TABLE IF NOT EXISTS block. No-op where it exists.

CREATE INDEX IF NOT EXISTS "idx_approval_process_admins_user" ON "approval_process_admins"("user_id");
