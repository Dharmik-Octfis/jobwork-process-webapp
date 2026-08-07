-- jobwork_sprint1_foundation
--
-- Sprint 1 of docs/JOBWORK_IMPLEMENTATION_PLAN.md — the plumbing, plus the one
-- small module (Processes) that proves the full stack end to end.
--
-- Four new tables:
--   lots           traceable quantity; carries ownership + genealogy
--   lot_packages   the takas — individually measured, variable quantities
--   stock_ledger   🔴 every movement, append-only. Balances are DERIVED
--   processes      the operation master
--
-- Three extensions to existing tables: items (stocking uom + lot tracking +
-- nature + default route), locations (vendor link for processor locations),
-- vendors (vendor types).
--
-- 🔴 Two columns exist here that nothing reads until Sprints 2–4 and are in this
-- migration deliberately: `lots.ownership` (+ `owner_party_id`) and
-- `lots.parent_lot_ids`. Retrofitting ownership means revisiting every valuation
-- query ever written; genealogy cannot be reconstructed from history that was
-- never recorded. Domain doc §11.3.
--
-- Not destructive: every statement is an ADD or a CREATE. The one data-touching
-- step is the `items.stocking_uom_id` backfill below, which only fills a column
-- that did not exist a moment ago.

-- ---------------------------------------------------------------------------
-- items — stocking uom, lot tracking, nature, default route
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "default_route_id" UUID,
ADD COLUMN     "lot_tracking" VARCHAR(20) NOT NULL DEFAULT 'none',
ADD COLUMN     "nature" VARCHAR(20) NOT NULL DEFAULT 'raw',
ADD COLUMN     "stocking_uom_id" UUID;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "vendor_id" UUID;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "vendor_types" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- CreateTable
-- ---------------------------------------------------------------------------

CREATE TABLE "lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "lot_number" VARCHAR(50) NOT NULL,
    "supplier_lot_ref" VARCHAR(100),
    "item_id" UUID NOT NULL,
    "uom_id" UUID,
    "ownership" VARCHAR(20) NOT NULL DEFAULT 'own',
    "owner_party_id" UUID,
    "parent_lot_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "source_doc_type" VARCHAR(40),
    "source_doc_id" UUID,
    "state" VARCHAR(20) NOT NULL DEFAULT 'open',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lot_packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "package_number" INTEGER NOT NULL,
    "label" VARCHAR(60),
    "qty" DECIMAL(18,4) NOT NULL,
    "parent_package_id" UUID,
    "state" VARCHAR(20) NOT NULL DEFAULT 'available',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_packages_pkey" PRIMARY KEY ("id")
);

-- 🔴 Append-only. No is_deleted, no updated_by, no custom_fields: a ledger row is
-- a fact that happened, not a domain entity with a form behind it. A correction
-- is a REVERSING ENTRY, never an edit and never a delete.
CREATE TABLE "stock_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "lot_package_id" UUID,
    "location_id" UUID NOT NULL,
    "ownership" VARCHAR(20) NOT NULL DEFAULT 'own',
    "owner_party_id" UUID,
    "uom_id" UUID,
    "qty_in" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qty_out" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value_in" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value_out" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "movement_type" VARCHAR(30) NOT NULL,
    "source_doc_type" VARCHAR(40) NOT NULL,
    "source_doc_id" UUID,
    "source_doc_line_id" UUID,
    "remarks" TEXT,
    "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "item_changes" BOOLEAN NOT NULL DEFAULT false,
    "rate_basis" VARCHAR(30) NOT NULL DEFAULT 'per_issued_unit',
    "preserves_packaging" BOOLEAN NOT NULL DEFAULT false,
    "requires_single_lot" BOOLEAN NOT NULL DEFAULT false,
    "default_tolerance_pct" DECIMAL(6,3),
    "default_issue_uom_id" UUID,
    "default_receive_uom_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- CreateIndex
--
-- The three unique indexes are all on brand-new tables, so there are no existing
-- duplicates to fail on. The one on `processes` DOES include soft-deleted rows —
-- a soft-deleted row keeps occupying its key — so `processes.service.ts` REVIVES
-- a soft-deleted row on a name collision instead of 409-ing. "Dyeing" deleted
-- last month must be creatable again.
-- ---------------------------------------------------------------------------

CREATE INDEX "lots_organization_id_item_id_idx" ON "lots"("organization_id", "item_id");
CREATE UNIQUE INDEX "lots_organization_id_lot_number_key" ON "lots"("organization_id", "lot_number");

CREATE INDEX "lot_packages_organization_id_lot_id_idx" ON "lot_packages"("organization_id", "lot_id");
CREATE UNIQUE INDEX "lot_packages_lot_id_package_number_key" ON "lot_packages"("lot_id", "package_number");

-- The balance query's index (domain doc §5.6). The second one serves the
-- "stock lying with processors, aged" report that GST's 180/365-day rule needs.
CREATE INDEX "stock_ledger_organization_id_item_id_lot_id_location_id_idx" ON "stock_ledger"("organization_id", "item_id", "lot_id", "location_id");
CREATE INDEX "stock_ledger_organization_id_location_id_posted_at_idx" ON "stock_ledger"("organization_id", "location_id", "posted_at");

CREATE UNIQUE INDEX "processes_organization_id_name_key" ON "processes"("organization_id", "name");

-- ---------------------------------------------------------------------------
-- AddForeignKey
-- ---------------------------------------------------------------------------

ALTER TABLE "lots" ADD CONSTRAINT "lots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_owner_party_id_fkey" FOREIGN KEY ("owner_party_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lot_packages" ADD CONSTRAINT "lot_packages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_packages" ADD CONSTRAINT "lot_packages_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_packages" ADD CONSTRAINT "lot_packages_parent_package_id_fkey" FOREIGN KEY ("parent_package_id") REFERENCES "lot_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lot_packages" ADD CONSTRAINT "lot_packages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lot_packages" ADD CONSTRAINT "lot_packages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_lot_package_id_fkey" FOREIGN KEY ("lot_package_id") REFERENCES "lot_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "items" ADD CONSTRAINT "items_stocking_uom_id_fkey" FOREIGN KEY ("stocking_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "processes" ADD CONSTRAINT "processes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "processes" ADD CONSTRAINT "processes_default_issue_uom_id_fkey" FOREIGN KEY ("default_issue_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "processes" ADD CONSTRAINT "processes_default_receive_uom_id_fkey" FOREIGN KEY ("default_receive_uom_id") REFERENCES "units_of_measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "processes" ADD CONSTRAINT "processes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "processes" ADD CONSTRAINT "processes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "locations" ADD CONSTRAINT "locations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: items.stocking_uom_id from the legacy free-text items.unit
--
-- `items.unit` has been a bare string with no relation since the table was
-- created. The stock ledger cannot work off a string — a balance is one number in
-- one unit, and "MTR" typed three ways is three units.
--
-- Matching is per organization (uom names are unique per org), case-insensitive
-- and whitespace-trimmed, against non-deleted units only. Anything that does not
-- match is LEFT NULL on purpose: an item whose unit was a typo, or a unit nobody
-- ever defined, has no correct answer, and inventing one would put a silently
-- wrong unit on every future lot of that item. The jobwork screens ask for a
-- stocking uom before they will move an item's stock, so an unmatched row fails
-- loudly and is fixable in one edit.
--
-- `items.unit` is deliberately NOT dropped. It is still what the item form shows
-- and what every existing read expects; removing it is a separate, reversible
-- decision once the FK has proven itself.
-- ---------------------------------------------------------------------------

UPDATE "items" i
SET "stocking_uom_id" = u."id"
FROM "units_of_measurement" u
WHERE u."organization_id" = i."organization_id"
  AND u."is_deleted" = false
  AND lower(btrim(u."unit_name")) = lower(btrim(i."unit"))
  AND i."stocking_uom_id" IS NULL;

-- ---------------------------------------------------------------------------
-- 🔴 Row-Level Security — the four new tenant tables
--
-- Copied verbatim from migrations/20260716183126_enable_rls, which explains the
-- expression piece by piece. In short: `current_setting(..., true)` returns NULL
-- rather than erroring when unset, NULLIF maps '' to NULL so ''::uuid cannot
-- raise, and USING/WITH CHECK together cover both what you can SEE and what you
-- can WRITE — USING alone would still let a caller INSERT a row belonging to
-- another organization.
--
-- lot_packages carries its own organization_id (denormalised from its lot) rather
-- than scoping through the parent, so its policy compares directly like
-- payment_terms does, not via a join like vendor_activities.
--
-- All four are added to TENANT_TABLES in src/db/rls.test.ts in the same change —
-- a tenant table with no policy is unprotected and nothing will tell you.
-- ---------------------------------------------------------------------------

ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "lots"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "lot_packages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "lot_packages"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "stock_ledger" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "stock_ledger"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "processes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "processes"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- No GRANTs needed: 20260716183126_enable_rls set ALTER DEFAULT PRIVILEGES so
-- tables created by the migration role are readable/writable by jobwork_app.
