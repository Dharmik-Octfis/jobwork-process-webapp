-- `ENABLE ROW LEVEL SECURITY` does not apply to a table's OWNER. The app
-- currently connects as `postgres`, which owns every table, so these policies
-- are inert until DATABASE_URL is switched to the `jobwork_app` role created
-- below. That is deliberate: it lets the policies land ahead of the cutover
-- rather than in the same risky step.
--
-- Protection turns ON at the moment you switch DATABASE_URL, not here.
-- See docs/PRISMA.md §8 "Turning RLS on" for that runbook.
-- ─────────────────────────────────────────────────────────────────────────────

-- PREREQUISITE: the `jobwork_app` role must already exist.
--
--   CREATE ROLE jobwork_app LOGIN PASSWORD '<from your secret store>';
DROP POLICY IF EXISTS "tenant_isolation" ON "vendors";
DROP POLICY IF EXISTS "Tenant isolation" ON "vendors";
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendors"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "items";
DROP POLICY IF EXISTS "Tenant isolation" ON "items";
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "items"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "number_sequences";
DROP POLICY IF EXISTS "Tenant isolation" ON "number_sequences";
ALTER TABLE "number_sequences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "number_sequences"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "vendor_contact_persons";
DROP POLICY IF EXISTS "Tenant isolation" ON "vendor_contact_persons";
ALTER TABLE "vendor_contact_persons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_contact_persons"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "vendor_activities";
DROP POLICY IF EXISTS "Tenant isolation" ON "vendor_activities";
ALTER TABLE "vendor_activities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_activities"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "vendor_comments";
DROP POLICY IF EXISTS "Tenant isolation" ON "vendor_comments";
ALTER TABLE "vendor_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_comments"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "vendor_addresses";
DROP POLICY IF EXISTS "Tenant isolation" ON "vendor_addresses";
ALTER TABLE "vendor_addresses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "vendor_addresses"
  USING (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "vendors" v WHERE v.id = vendor_id
    AND v.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "units_of_measurement";
DROP POLICY IF EXISTS "Tenant isolation" ON "units_of_measurement";
ALTER TABLE "units_of_measurement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "units_of_measurement"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "currencies";
DROP POLICY IF EXISTS "Tenant isolation" ON "currencies";
ALTER TABLE "currencies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "currencies"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "custom_field_definitions";
DROP POLICY IF EXISTS "Tenant isolation" ON "custom_field_definitions";
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "custom_field_definitions"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "permission_templates";
DROP POLICY IF EXISTS "Tenant isolation" ON "permission_templates";
ALTER TABLE "permission_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "permission_templates"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "customers";
DROP POLICY IF EXISTS "Tenant isolation" ON "customers";
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customers"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "customer_contact_persons";
DROP POLICY IF EXISTS "Tenant isolation" ON "customer_contact_persons";
ALTER TABLE "customer_contact_persons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_contact_persons"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "customer_activities";
DROP POLICY IF EXISTS "Tenant isolation" ON "customer_activities";
ALTER TABLE "customer_activities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_activities"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "customer_comments";
DROP POLICY IF EXISTS "Tenant isolation" ON "customer_comments";
ALTER TABLE "customer_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_comments"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "customer_addresses";
DROP POLICY IF EXISTS "Tenant isolation" ON "customer_addresses";
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "customer_addresses"
  USING (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "customers" c WHERE c.id = customer_id
    AND c.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "item_activities";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_activities";
ALTER TABLE "item_activities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "item_activities"
  USING (EXISTS (SELECT 1 FROM "items" i WHERE i.id = item_id
    AND i.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "items" i WHERE i.id = item_id
    AND i.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "payment_terms";
DROP POLICY IF EXISTS "Tenant isolation" ON "payment_terms";
ALTER TABLE "payment_terms" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "payment_terms"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "list_view_preferences";
DROP POLICY IF EXISTS "Tenant isolation" ON "list_view_preferences";
ALTER TABLE "list_view_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "list_view_preferences"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "permission_templates";
DROP POLICY IF EXISTS "Tenant isolation" ON "permission_templates";
ALTER TABLE "permission_templates" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "permission_templates";
DROP POLICY IF EXISTS "tenant_isolation" ON "roles";
DROP POLICY IF EXISTS "Tenant isolation" ON "roles";
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "roles"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "locations";
DROP POLICY IF EXISTS "Tenant isolation" ON "locations";
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "locations"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "stock_ledger";
DROP POLICY IF EXISTS "Tenant isolation" ON "stock_ledger";
ALTER TABLE "stock_ledger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "stock_ledger"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "processes";
DROP POLICY IF EXISTS "Tenant isolation" ON "processes";
ALTER TABLE "processes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "processes"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "routes";
DROP POLICY IF EXISTS "Tenant isolation" ON "routes";
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "routes"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "route_steps";
DROP POLICY IF EXISTS "Tenant isolation" ON "route_steps";
ALTER TABLE "route_steps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "route_steps"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_orders";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_orders";
ALTER TABLE "job_orders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_orders"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_order_steps";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_order_steps";
ALTER TABLE "job_order_steps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_order_steps"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_issues";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_issues";
ALTER TABLE "job_issues" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_issues"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_issue_lines";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_issue_lines";
ALTER TABLE "job_issue_lines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_issue_lines"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "rejection_reasons";
DROP POLICY IF EXISTS "Tenant isolation" ON "rejection_reasons";
ALTER TABLE "rejection_reasons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "rejection_reasons"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_receipts";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_receipts";
ALTER TABLE "job_receipts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_receipts"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_receipt_lines";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_receipt_lines";
ALTER TABLE "job_receipt_lines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_receipt_lines"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "route_step_inputs";
DROP POLICY IF EXISTS "Tenant isolation" ON "route_step_inputs";
ALTER TABLE "route_step_inputs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "route_step_inputs"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "route_step_outputs";
DROP POLICY IF EXISTS "Tenant isolation" ON "route_step_outputs";
ALTER TABLE "route_step_outputs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "route_step_outputs"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_order_step_inputs";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_order_step_inputs";
ALTER TABLE "job_order_step_inputs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_order_step_inputs"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_order_step_outputs";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_order_step_outputs";
ALTER TABLE "job_order_step_outputs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_order_step_outputs"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "job_receipt_outputs";
DROP POLICY IF EXISTS "Tenant isolation" ON "job_receipt_outputs";
ALTER TABLE "job_receipt_outputs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_receipt_outputs"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "composite_item_components";
DROP POLICY IF EXISTS "Tenant isolation" ON "composite_item_components";
ALTER TABLE "composite_item_components" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "item_assemblies";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_assemblies";
ALTER TABLE "item_assemblies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "item_assembly_lines";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_assembly_lines";
ALTER TABLE "item_assembly_lines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "composite_item_components"
  AS PERMISSIVE FOR ALL
  TO public
  USING ((organization_id = (current_setting('app.current_tenant_id'::text, true))::uuid));
DROP POLICY IF EXISTS "tenant_isolation" ON "item_assembly_comments";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_assembly_comments";
ALTER TABLE "item_assembly_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "item_assembly_comments"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "item_assembly_activities";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_assembly_activities";
ALTER TABLE "item_assembly_activities" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON "item_assembly_activities"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "item_opening_stock_rows";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_opening_stock_rows";
ALTER TABLE "item_opening_stock_rows" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON "item_opening_stock_rows"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "item_location_stocks";
DROP POLICY IF EXISTS "Tenant isolation" ON "item_location_stocks";
ALTER TABLE "item_location_stocks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON "item_location_stocks"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
DROP POLICY IF EXISTS "tenant_isolation" ON "bills";
DROP POLICY IF EXISTS "Tenant isolation" ON "bills";
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "bills"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
