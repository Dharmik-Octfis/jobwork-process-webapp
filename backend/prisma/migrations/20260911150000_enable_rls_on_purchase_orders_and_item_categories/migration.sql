-- enable_rls_on_purchase_orders_and_item_categories
--
-- 🔴 FOUR TENANT TABLES HAVE BEEN CROSS-TENANT READABLE. Found 2026-09-11 while
-- restoring lost index migrations: `relrowsecurity = false` and zero policies on
-- `item_categories`, `purchase_order_items`, `purchase_order_activities` and
-- `purchase_order_comments`. `item_categories` is the sharp one — it carries its
-- own `organization_id` and holds 16 rows spanning TWO organizations, so an
-- unfiltered read returned both.
--
-- WHY NOTHING CAUGHT IT. None of the five was listed in `TENANT_TABLES` in
-- `src/db/rls.test.ts`, and that list is the only thing that checks. All five
-- were created out-of-band, so they never went through the "new tenant table"
-- checklist in CLAUDE.md. This is the failure mode that doc describes verbatim:
-- a tenant table with no policy is unprotected and nothing tells you.
--
-- TWO POLICY FORMS, because the tables are not shaped alike:
--   * `item_categories` has `organization_id` -> the direct form, like `vendors`.
--   * the three `purchase_order_*` children have NO `organization_id` column at
--     all, only `is_deleted`, so they scope through `purchase_orders` on
--     `purchase_order_id` -> the join-through form, exactly like the `vendor_*`
--     children in 20260720120100_rename_dial_code_and_enable_vendor_rls.
--   * `purchase_orders` already had RLS and a `tenant_isolation` policy, created
--     out-of-band. It is stated here too so this file is the single on-disk
--     source for all five, but the guard below finds the existing policy and
--     leaves it untouched — its live definition was read back and verified
--     identical to the form written here, so nothing about it changes either way.
--
-- WHY TURNING IT ON IS SAFE HERE, checked rather than assumed:
--   1. All five are owned by `postgres`, NOT by `jobwork_app`. An owner bypasses
--      its own policies, which is how RLS becomes theatre — `vendors` has the
--      same owner, so these behave the same way.
--   2. `jobwork_app` holds SELECT/INSERT/UPDATE/DELETE on each, so the policy is
--      the only thing that changes, not access.
--   3. Nothing reads them outside a tenant transaction: there are no
--      `prisma.itemCategory` / `prisma.purchaseOrder` / `prisma.purchaseOrderItem`
--      call sites, only `tx.` ones inside `runAsTenant` (13 in the module).
--      If that ever stops being true the symptom is ZERO ROWS — it fails closed
--      and loudly, which is the whole design.
--
-- IDEMPOTENT WITHOUT EVER DROPPING A POLICY, which matters more here than
-- brevity. `CREATE POLICY` has no `IF NOT EXISTS`, and the obvious fix — removing
-- the policy by name first, then recreating it — was written that way first and
-- rejected by `db:apply`, correctly: migrations here are NOT transactional, so a
-- failure between those two statements would leave a tenant table enabled for
-- RLS with no policy at all. Guarding on `pg_policies` instead means a policy is
-- only ever added, never momentarily absent. `ENABLE ROW LEVEL SECURITY` is
-- already a no-op when it is on.
--
-- A consequence worth stating: this file will NOT rewrite a `tenant_isolation`
-- policy that already exists under that name. For `purchase_orders` that is
-- exactly what we want — its live policy was verified byte-identical to the form
-- below — but if a policy of this name is ever changed, changing it takes its own
-- migration rather than a silent overwrite from a re-run of this one.
--
-- 🔴 THESE FIVE TABLES STILL HAVE NO `CREATE TABLE` ON DISK, so this file cannot
-- run against a database rebuilt from `prisma/migrations` — which already fails
-- earlier anyway, at `20260819090112_link_bills_to_po:14`, on an FK referencing
-- the `purchase_orders` table no migration creates. Restoring those five tables
-- is separate work and has to be dated BEFORE that migration; this one then
-- lands after it and gates them.

-- 1. item_categories — carries its own organization_id (direct form) -----------
ALTER TABLE "item_categories" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'item_categories'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "item_categories"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

-- 2. purchase_orders — already gated out-of-band; restated so this file is the
--    single on-disk source. The guard leaves the verified existing policy alone.
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'purchase_orders'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "purchase_orders"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

-- 3. purchase_order_* children — no organization_id of their own, so they scope
--    through the parent purchase order (join-through form, like vendor_*).
ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'purchase_order_items'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "purchase_order_items"
      USING (EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po.id = purchase_order_id
        AND po.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po.id = purchase_order_id
        AND po.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;

ALTER TABLE "purchase_order_activities" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'purchase_order_activities'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "purchase_order_activities"
      USING (EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po.id = purchase_order_id
        AND po.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po.id = purchase_order_id
        AND po.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;

ALTER TABLE "purchase_order_comments" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'purchase_order_comments'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "purchase_order_comments"
      USING (EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po.id = purchase_order_id
        AND po.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (EXISTS (SELECT 1 FROM "purchase_orders" po WHERE po.id = purchase_order_id
        AND po.organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;
