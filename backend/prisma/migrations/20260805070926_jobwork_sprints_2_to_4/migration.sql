-- jobwork_sprints_2_to_4
--
-- Sprints 2, 3 and 4 of docs/JOBWORK_IMPLEMENTATION_PLAN.md, in one migration
-- because they ship together. Nine new tables, no changes to any existing one:
--
--   routes · route_steps            the reusable template (Sprint 2)
--   job_orders · job_order_steps    one run — steps are a SNAPSHOT of the route,
--                                   never a live link (§2.4)
--   job_issues · job_issue_lines    the challan out (Sprint 3)
--   rejection_reasons               the small per-org master wastage analysis
--                                   needs, because free text cannot be grouped
--   job_receipts · job_receipt_lines  goods back, with the disposition split
--
-- Every statement is a CREATE or an ADD. Nothing is dropped, nothing is
-- back-filled, and no existing row is touched.
--
-- 🔴 WHAT WAS REMOVED FROM THE GENERATED DRAFT, AND WHY
--
-- `migrate diff` also emitted six DROP COLUMNs — `ip_address`, `latitude` and
-- `longitude` on `users` and on `refresh_tokens`. Those columns exist in the
-- database and in no schema file, so the diff correctly reports them as drift,
-- but that drift PRE-DATES this work and has nothing to do with jobwork.
-- Dropping them here would destroy their data as a side effect of adding nine
-- unrelated tables, in a migration nobody would think to look in afterwards.
-- They are left exactly as they are; closing that gap is its own decision and
-- its own migration.

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "routes" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "route_steps" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "route_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "process_id" UUID NOT NULL,
    "processor_type" VARCHAR(20) NOT NULL DEFAULT 'vendor',
    "processor_id" UUID,
    "work_centre_location_id" UUID,
    "rate" DECIMAL(18,4),
    "rate_basis" VARCHAR(30),
    "issue_item_id" UUID,
    "issue_uom_id" UUID,
    "receive_item_id" UUID,
    "receive_uom_id" UUID,
    "expected_yield" DECIMAL(18,6),
    "tolerance_pct" DECIMAL(6,3),
    "remarks" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "job_orders" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "job_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_order_number" VARCHAR(50) NOT NULL,
    "order_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_date" TIMESTAMPTZ(6),
    "input_item_id" UUID NOT NULL,
    "input_uom_id" UUID,
    "input_qty" DECIMAL(18,4) NOT NULL,
    "route_id" UUID,
    "route_name_snapshot" VARCHAR(150),
    "ownership" VARCHAR(20) NOT NULL DEFAULT 'own',
    "owner_party_id" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "remarks" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "job_order_steps" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "job_order_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "process_id" UUID NOT NULL,
    "process_name_snapshot" VARCHAR(150) NOT NULL,
    "processor_type" VARCHAR(20) NOT NULL DEFAULT 'vendor',
    "processor_id" UUID,
    "processor_name_snapshot" VARCHAR(255),
    "work_centre_location_id" UUID,
    "rate" DECIMAL(18,4),
    "rate_basis" VARCHAR(30),
    "issue_item_id" UUID,
    "issue_uom_id" UUID,
    "receive_item_id" UUID,
    "receive_uom_id" UUID,
    "expected_yield" DECIMAL(18,6),
    "tolerance_pct" DECIMAL(6,3),
    "planned_input_qty" DECIMAL(18,4),
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "remarks" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_order_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "job_issues" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "job_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "job_order_step_id" UUID NOT NULL,
    "challan_number" VARCHAR(50) NOT NULL,
    "issue_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processor_type" VARCHAR(20) NOT NULL DEFAULT 'vendor',
    "processor_id" UUID,
    "processor_name_snapshot" VARCHAR(255),
    "processor_address_snapshot" TEXT,
    "processor_gstin_snapshot" VARCHAR(20),
    "source_location_id" UUID NOT NULL,
    "destination_location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "uom_id" UUID,
    "is_rework" BOOLEAN NOT NULL DEFAULT false,
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "transporter_id" UUID,
    "vehicle_no" VARCHAR(30),
    "lr_no" VARCHAR(50),
    "lr_date" TIMESTAMPTZ(6),
    "eway_bill_no" VARCHAR(30),
    "total_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tolerance_override_reason" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'issued',
    "remarks" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "job_issue_lines" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "job_issue_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_issue_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "lot_package_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "rejection_reasons" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "rejection_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "default_responsibility" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejection_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "job_receipts" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "job_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "job_order_step_id" UUID NOT NULL,
    "receipt_number" VARCHAR(50) NOT NULL,
    "receipt_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processor_type" VARCHAR(20) NOT NULL DEFAULT 'vendor',
    "processor_id" UUID,
    "processor_name_snapshot" VARCHAR(255),
    "mode" VARCHAR(20) NOT NULL DEFAULT 'bulk',
    "output_item_id" UUID NOT NULL,
    "output_uom_id" UUID,
    "location_id" UUID NOT NULL,
    "output_lot_id" UUID,
    "rework_lot_id" UUID,
    "total_issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_rework_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_scrap_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(30) NOT NULL DEFAULT 'posted',
    "remarks" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- ⚠️ REVIEW [TENANT TABLE WITHOUT RLS] "job_receipt_lines" has organization_id but this migration never enables RLS on it. Copy the policy statements from migrations/*_enable_rls and add it to TENANT_TABLES in src/db/rls.test.ts
CREATE TABLE "job_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "job_receipt_id" UUID NOT NULL,
    "job_issue_id" UUID,
    "job_issue_line_id" UUID,
    "parent_package_id" UUID,
    "issued_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accepted_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rework_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "scrap_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reason_id" UUID,
    "responsibility" VARCHAR(20),
    "remarks" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "routes_organization_id_name_key" ON "routes"("organization_id", "name");

-- CreateIndex
CREATE INDEX "route_steps_organization_id_route_id_idx" ON "route_steps"("organization_id", "route_id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "route_steps_route_id_seq_key" ON "route_steps"("route_id", "seq");

-- CreateIndex
CREATE INDEX "job_orders_organization_id_status_idx" ON "job_orders"("organization_id", "status");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "job_orders_organization_id_job_order_number_key" ON "job_orders"("organization_id", "job_order_number");

-- CreateIndex
CREATE INDEX "job_order_steps_organization_id_job_order_id_idx" ON "job_order_steps"("organization_id", "job_order_id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "job_order_steps_job_order_id_seq_key" ON "job_order_steps"("job_order_id", "seq");

-- CreateIndex
CREATE INDEX "job_issues_organization_id_job_order_step_id_idx" ON "job_issues"("organization_id", "job_order_step_id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "job_issues_organization_id_challan_number_key" ON "job_issues"("organization_id", "challan_number");

-- CreateIndex
CREATE INDEX "job_issue_lines_organization_id_job_issue_id_idx" ON "job_issue_lines"("organization_id", "job_issue_id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "rejection_reasons_organization_id_name_key" ON "rejection_reasons"("organization_id", "name");

-- CreateIndex
CREATE INDEX "job_receipts_organization_id_job_order_step_id_idx" ON "job_receipts"("organization_id", "job_order_step_id");

-- CreateIndex
-- ⚠️ REVIEW [ADD UNIQUE] fails on existing duplicates; remember soft-deleted rows still occupy their unique key
CREATE UNIQUE INDEX "job_receipts_organization_id_receipt_number_key" ON "job_receipts"("organization_id", "receipt_number");

-- CreateIndex
CREATE INDEX "job_receipt_lines_organization_id_job_receipt_id_idx" ON "job_receipt_lines"("organization_id", "job_receipt_id");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_issue_item_id_fkey" FOREIGN KEY ("issue_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_receive_item_id_fkey" FOREIGN KEY ("receive_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_issue_uom_id_fkey" FOREIGN KEY ("issue_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_receive_uom_id_fkey" FOREIGN KEY ("receive_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_work_centre_location_id_fkey" FOREIGN KEY ("work_centre_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_input_item_id_fkey" FOREIGN KEY ("input_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_input_uom_id_fkey" FOREIGN KEY ("input_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_issue_item_id_fkey" FOREIGN KEY ("issue_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_receive_item_id_fkey" FOREIGN KEY ("receive_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_issue_uom_id_fkey" FOREIGN KEY ("issue_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_receive_uom_id_fkey" FOREIGN KEY ("receive_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_work_centre_location_id_fkey" FOREIGN KEY ("work_centre_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_steps" ADD CONSTRAINT "job_order_steps_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_job_order_step_id_fkey" FOREIGN KEY ("job_order_step_id") REFERENCES "job_order_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issues" ADD CONSTRAINT "job_issues_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_job_issue_id_fkey" FOREIGN KEY ("job_issue_id") REFERENCES "job_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_lot_package_id_fkey" FOREIGN KEY ("lot_package_id") REFERENCES "lot_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_lines" ADD CONSTRAINT "job_issue_lines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejection_reasons" ADD CONSTRAINT "rejection_reasons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejection_reasons" ADD CONSTRAINT "rejection_reasons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejection_reasons" ADD CONSTRAINT "rejection_reasons_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_job_order_step_id_fkey" FOREIGN KEY ("job_order_step_id") REFERENCES "job_order_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_output_uom_id_fkey" FOREIGN KEY ("output_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_output_lot_id_fkey" FOREIGN KEY ("output_lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_rework_lot_id_fkey" FOREIGN KEY ("rework_lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_job_receipt_id_fkey" FOREIGN KEY ("job_receipt_id") REFERENCES "job_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_job_issue_id_fkey" FOREIGN KEY ("job_issue_id") REFERENCES "job_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_job_issue_line_id_fkey" FOREIGN KEY ("job_issue_line_id") REFERENCES "job_issue_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_parent_package_id_fkey" FOREIGN KEY ("parent_package_id") REFERENCES "lot_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "rejection_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_receipt_lines" ADD CONSTRAINT "job_receipt_lines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security — the net under every `where: { organizationId }`
-- ---------------------------------------------------------------------------
--
-- 🔴 All nine tables carry their own `organization_id` and their own policy,
-- including the LINE tables. A line table could have been scoped by joining its
-- header, and that is exactly the shape that leaves it unprotected the first
-- time someone queries it directly — `lot_packages` made the same call in
-- Sprint 1 and for the same reason.
--
-- All nine are added to TENANT_TABLES in src/db/rls.test.ts in the same change.
-- A tenant table with no policy is unprotected and nothing will tell you.

ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "routes"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "route_steps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "route_steps"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "job_orders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_orders"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "job_order_steps" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_order_steps"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "job_issues" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_issues"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "job_issue_lines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_issue_lines"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "rejection_reasons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "rejection_reasons"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "job_receipts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_receipts"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "job_receipt_lines" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "job_receipt_lines"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- No GRANTs needed: 20260716183126_enable_rls set ALTER DEFAULT PRIVILEGES so
-- tables created by the migration role are readable/writable by jobwork_app.
