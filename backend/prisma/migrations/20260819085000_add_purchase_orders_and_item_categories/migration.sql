-- add_purchase_orders_and_item_categories
--
-- 🔴 BACKDATED ON PURPOSE, AND IT HAS TO BE. This file is timestamped BEFORE
-- `20260819090112_link_bills_to_po`, which is not tidiness — that migration adds
-- `bills_source_po_id_fkey` REFERENCING `purchase_orders`, so until these tables
-- exist earlier in the sequence, `migrate deploy` against an empty database dies
-- there. Reproduced on a scratch database 2026-09-11 before writing this:
--
--   Applying migration `20260819090112_link_bills_to_po`
--   Error: P3018 ... Database error code: 42P01
--   ERROR: relation "purchase_orders" does not exist
--
-- So the repo could NOT rebuild a database from its own migrations at all. Not
-- "rebuilds and quietly loses some indexes" — fails outright, part-built, with
-- 79 of 90 migrations applied and no way forward or back (migrations here are
-- not transactional).
--
-- HOW FIVE TABLES CAME TO EXIST WITH NO MIGRATION. They were created by
-- something that makes the live database match the schema files while writing
-- nothing to `prisma/migrations` or `_prisma_migrations` — `prisma db push` does
-- exactly that, which is why `npm run db:push` is now a guard script that
-- refuses to run. The evidence is in the catalog: all five have consecutive
-- `pg_class.oid`s (102974, 102993, 103023, 103048, 103065), so they were created
-- in one operation, and no migration record has ever mentioned them.
--
-- 🔴 FOREIGN KEYS ARE DECLARED INLINE, not added afterwards, and that choice is
-- what makes this file idempotent with no guard blocks at all. `ALTER TABLE ADD
-- CONSTRAINT` has no `IF NOT EXISTS`, so 21 separate FKs would each have needed a
-- `DO` block checking `pg_constraint`. Inline, they ride on
-- `CREATE TABLE IF NOT EXISTS`: on a rebuild the table is created with its keys,
-- and on a database that already has these tables the whole statement is skipped
-- — keys included. Constraint names are Prisma's own, so a rebuilt database
-- matches the live one name for name.
--
-- TABLE ORDER IS DEPENDENCY ORDER, which inline FKs require: `item_categories`
-- (self-referencing parent_id), then `purchase_orders`, then its three children.
--
-- `bills_source_po_id_fkey` IS DELIBERATELY ABSENT. It is the one inbound FK and
-- `20260819090112` — the migration immediately after this one — already creates
-- it. Adding it here too would fail on the second attempt.
--
-- NO RLS HERE. These are tenant tables and they need policies, but those live in
-- `20260911150000_enable_rls_on_purchase_orders_and_item_categories`, which runs
-- later in the sequence and gates all five. Keeping the two apart means this file
-- reproduces what was pushed out-of-band and that one records the security fix,
-- rather than blurring a 2026-08 accident into a 2026-09 decision.
--
-- The DDL below is `prisma migrate diff --from-empty --to-schema` output, not
-- hand-typed: it is generated from the schema files, which `db:check-drift`
-- already proves match the live database for these five tables.

-- Tables -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "item_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "item_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_categories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "delivery_type" VARCHAR(50) NOT NULL DEFAULT 'Location',
    "delivery_location_id" UUID,
    "delivery_customer_id" UUID,
    "po_number" VARCHAR(100) NOT NULL,
    "po_date" DATE NOT NULL,
    "delivery_date" DATE,
    "payment_terms" VARCHAR(100),
    "sub_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'Draft',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location_id" UUID,
    "attachments" JSONB DEFAULT '[]',
    "terms_and_conditions" TEXT,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_delivery_customer_id_fkey" FOREIGN KEY ("delivery_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_delivery_location_id_fkey" FOREIGN KEY ("delivery_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_po_status" VARCHAR(50),
    "linked_sales_order_id" UUID,
    "total_weight" DECIMAL(15,2),
    "cost_price" DECIMAL(15,2),
    "quantity" DECIMAL(15,2) NOT NULL DEFAULT 1,
    "rate" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discount_percentage" DECIMAL(5,2),
    "discount_amount" DECIMAL(15,2),
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "project_id" UUID,
    "reporting_tags" JSONB,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "purchase_order_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_activities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_activities_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "purchase_order_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_comments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_order_comments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Unique constraints these tables carry -------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "item_categories_organization_id_name_parent_id_key" ON "item_categories"("organization_id", "name", "parent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_organization_id_po_number_key" ON "purchase_orders"("organization_id", "po_number");
