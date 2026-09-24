-- Per-user, per-organization report history: last visited + favourite.
--
-- Replaces two browser-localStorage keys (`lastVisited_<report>_<org>`,
-- `favorite_reports_<org>`) that were per-browser, not per-user, and fell back
-- to hard-coded dates when empty. The report list itself stays in code
-- (`src/modules/reports/reports.catalog.ts`); a row here only points at one by
-- its stable `report_key`.
--
-- Hand-authored rather than `db:draft`: on this branch the diff against the
-- shared dev database also emits DROP TABLE for tables other branches created,
-- so this file contains only the new table.
--
-- The RLS policy ships in the same migration as the table, and
-- `report_user_states` is in TENANT_TABLES in src/db/rls.test.ts. Guarded on
-- pg_policies (never DROP + CREATE) so a re-run can only ever add the policy.
--
-- No GRANTs needed: 20260716183126_enable_rls set ALTER DEFAULT PRIVILEGES so
-- tables created by the migration role are readable/writable by jobwork_app.

CREATE TABLE IF NOT EXISTS "report_user_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "report_key" VARCHAR(80) NOT NULL,
    "last_visited_at" TIMESTAMPTZ(6),
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_user_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "report_user_states_user_id_organization_id_report_key_key"
  ON "report_user_states"("user_id", "organization_id", "report_key");

ALTER TABLE "report_user_states" ADD CONSTRAINT "report_user_states_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_user_states" ADD CONSTRAINT "report_user_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_user_states" ADD CONSTRAINT "report_user_states_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_user_states" ADD CONSTRAINT "report_user_states_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carries its own organization_id, so the direct policy form.
ALTER TABLE "report_user_states" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'report_user_states'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "report_user_states"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;
