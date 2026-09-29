-- 20260918110000_create_approval_process_tables
-- Dynamic Approval Process Module (Zoho CRM Architecture)

CREATE TABLE IF NOT EXISTS "approval_processes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" VARCHAR(150) NOT NULL,
  "description" TEXT,
  "module_id" VARCHAR(100) NOT NULL,
  "trigger_type" VARCHAR(50) NOT NULL DEFAULT 'CREATE_OR_EDIT',
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "priority" INT NOT NULL DEFAULT 0,
  "current_version" INT NOT NULL DEFAULT 1,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_processes_org_module" ON "approval_processes"("organization_id", "module_id", "status", "is_deleted");
CREATE INDEX IF NOT EXISTS "idx_approval_processes_priority" ON "approval_processes"("organization_id", "module_id", "priority");

CREATE TABLE IF NOT EXISTS "approval_process_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "process_id" UUID NOT NULL REFERENCES "approval_processes"("id") ON DELETE CASCADE,
  "version_number" INT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_process_versions_proc" ON "approval_process_versions"("process_id", "version_number");

CREATE TABLE IF NOT EXISTS "approval_process_rules" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "process_id" UUID NOT NULL REFERENCES "approval_processes"("id") ON DELETE CASCADE,
  "name" VARCHAR(150) NOT NULL DEFAULT 'Rule 1',
  "rule_order" INT NOT NULL DEFAULT 1,
  "criteria" JSONB NOT NULL DEFAULT '[]',
  "criteria_pattern" VARCHAR(255) NOT NULL DEFAULT '1',
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_process_rules_proc" ON "approval_process_rules"("process_id", "rule_order", "is_deleted");

CREATE TABLE IF NOT EXISTS "approval_stages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "rule_id" UUID NOT NULL REFERENCES "approval_process_rules"("id") ON DELETE CASCADE,
  "name" VARCHAR(150) NOT NULL DEFAULT 'Stage 1',
  "stage_order" INT NOT NULL DEFAULT 1,
  "approver_type" VARCHAR(50) NOT NULL DEFAULT 'USER',
  "approver_config" JSONB NOT NULL DEFAULT '{}',
  "approval_mode" VARCHAR(50) NOT NULL DEFAULT 'ANYONE',
  "assign_task_for_approvers" BOOLEAN NOT NULL DEFAULT false,
  "record_modification_config" JSONB NOT NULL DEFAULT '{}',
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_stages_rule" ON "approval_stages"("rule_id", "stage_order", "is_deleted");

CREATE TABLE IF NOT EXISTS "approval_actions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "rule_id" UUID NOT NULL REFERENCES "approval_process_rules"("id") ON DELETE CASCADE,
  "stage_id" UUID REFERENCES "approval_stages"("id") ON DELETE CASCADE,
  "trigger_event" VARCHAR(50) NOT NULL DEFAULT 'FINAL_APPROVAL',
  "action_type" VARCHAR(50) NOT NULL,
  "action_config" JSONB NOT NULL DEFAULT '{}',
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_actions_rule" ON "approval_actions"("rule_id", "trigger_event", "is_deleted");

CREATE TABLE IF NOT EXISTS "approval_process_admins" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "process_id" UUID NOT NULL REFERENCES "approval_processes"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "can_override" BOOLEAN NOT NULL DEFAULT true,
  "can_reassign" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "uq_approval_process_admin" UNIQUE ("process_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_approval_process_admins_user" ON "approval_process_admins"("user_id");

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "process_id" UUID NOT NULL REFERENCES "approval_processes"("id") ON DELETE CASCADE,
  "process_version_id" UUID REFERENCES "approval_process_versions"("id") ON DELETE SET NULL,
  "rule_id" UUID REFERENCES "approval_process_rules"("id") ON DELETE SET NULL,
  "module_id" VARCHAR(100) NOT NULL,
  "record_id" VARCHAR(100) NOT NULL,
  "record_title" VARCHAR(255) NOT NULL,
  "record_snapshot" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  "current_stage_id" UUID REFERENCES "approval_stages"("id") ON DELETE SET NULL,
  "requester_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ(6),
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_requests_record" ON "approval_requests"("organization_id", "module_id", "record_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_requester" ON "approval_requests"("requester_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_requests_process" ON "approval_requests"("process_id", "status");

CREATE TABLE IF NOT EXISTS "approval_request_stages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "request_id" UUID NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "stage_id" UUID REFERENCES "approval_stages"("id") ON DELETE SET NULL,
  "stage_order" INT NOT NULL DEFAULT 1,
  "name" VARCHAR(150) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  "approval_mode" VARCHAR(50) NOT NULL DEFAULT 'ANYONE',
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "idx_approval_request_stages_req" ON "approval_request_stages"("request_id", "stage_order");

CREATE TABLE IF NOT EXISTS "approval_request_approvers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "request_stage_id" UUID NOT NULL REFERENCES "approval_request_stages"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  "action_taken_at" TIMESTAMPTZ(6),
  "comment" TEXT,
  "ip_address" VARCHAR(45),
  "user_agent" VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS "idx_approval_request_approvers_user" ON "approval_request_approvers"("user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_approval_request_approvers_stage" ON "approval_request_approvers"("request_stage_id");

CREATE TABLE IF NOT EXISTS "approval_history" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "request_id" UUID NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "event_type" VARCHAR(80) NOT NULL,
  "actor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "previous_status" VARCHAR(50),
  "new_status" VARCHAR(50),
  "comment" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_history_req" ON "approval_history"("request_id", "created_at");

CREATE TABLE IF NOT EXISTS "approval_action_executions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "request_id" UUID NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "action_id" UUID REFERENCES "approval_actions"("id") ON DELETE SET NULL,
  "action_type" VARCHAR(50) NOT NULL,
  "trigger_event" VARCHAR(50) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
  "attempts" INT NOT NULL DEFAULT 1,
  "error_message" TEXT,
  "payload_sent" JSONB,
  "response_received" JSONB,
  "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "next_retry_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "idx_approval_action_executions_req" ON "approval_action_executions"("request_id", "status");

CREATE TABLE IF NOT EXISTS "approval_notifications" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "request_id" UUID NOT NULL REFERENCES "approval_requests"("id") ON DELETE CASCADE,
  "recipient_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" VARCHAR(255) NOT NULL,
  "message" TEXT NOT NULL,
  "type" VARCHAR(50) NOT NULL DEFAULT 'APPROVAL_REQUIRED',
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_notifications_recip" ON "approval_notifications"("recipient_id", "is_read");

-- Enable Row Level Security (RLS) and create idempotent tenant policies

ALTER TABLE "approval_processes" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_processes' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_processes"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_process_versions" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_process_versions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_process_versions"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_process_rules" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_process_rules' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_process_rules"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_stages" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_stages' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_stages"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_actions" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_actions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_actions"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_process_admins" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_process_admins' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_process_admins"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_requests' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_requests"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_request_stages" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_request_stages' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_request_stages"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_request_approvers" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_request_approvers' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_request_approvers"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_history" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_history' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_history"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_action_executions" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_action_executions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_action_executions"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

ALTER TABLE "approval_notifications" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'approval_notifications' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "approval_notifications"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
