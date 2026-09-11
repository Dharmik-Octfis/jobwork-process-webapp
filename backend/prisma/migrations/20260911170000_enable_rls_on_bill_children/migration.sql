-- enable_rls_on_bill_children
--
-- 🔴 THREE TABLES ALREADY IN `TENANT_TABLES` HAD NO RLS IN THE MIGRATIONS.
-- `bill_items`, `bill_activities` and `bill_comments` are gated on the live
-- database — enabled out-of-band — but nothing in `prisma/migrations` enables
-- them, so a database rebuilt from this repo came up with all three ungated.
--
-- HOW THIS WAS FOUND, because it is the interesting part: `migrate diff` is
-- BLIND TO RLS. After the rebuild finally matched the schema it still reported
-- "This is an empty migration", and it always would have — policies and
-- `relrowsecurity` are simply not part of what it compares. The gap only showed
-- up on an independent count of the rebuilt database against the live one:
-- tables 69/69, indexes 163/163, foreign keys 294/294, but RLS tables 54 vs 57
-- and policies 54 vs 58. `db:check-drift` cannot catch this class of hole; only
-- `src/db/rls.test.ts` and a comparison like that one can.
--
-- THE JOIN-THROUGH FORM, and specifically `bill_id IN (SELECT ...)` rather than
-- the `EXISTS (...)` spelling used by the `vendor_*` and `purchase_order_*`
-- children. None of these three carries an `organization_id` of its own — only
-- `bill_id` — so they must reach the tenant through `bills`. The SQL below was
-- read back out of `pg_policies` on the live database and reproduces it exactly,
-- so a rebuilt database and the live one end up with identical policies rather
-- than two spellings of the same intent.
--
-- Contrast `bill_item_batches`, which `20260908075034_add_bill_item_batches`
-- gates with the DIRECT form: it denormalises `organization_id` from its parent
-- precisely so it can hold its own policy, because the balance query reaches it
-- without joining through `bills`.
--
-- IDEMPOTENT AND NEVER DROPPING A POLICY, for the reason `db:apply` rejected the
-- first draft of 20260911150000: `CREATE POLICY` has no `IF NOT EXISTS`, and
-- dropping one first would leave a window — migrations here are not
-- transactional — where the table is RLS-enabled with no policy, which is
-- ungated and silent. Guarding on `pg_policies` means a policy is only ever
-- added.

ALTER TABLE "bill_items" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'bill_items'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "bill_items"
      USING (bill_id IN (SELECT id FROM "bills"
        WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (bill_id IN (SELECT id FROM "bills"
        WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;

ALTER TABLE "bill_activities" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'bill_activities'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "bill_activities"
      USING (bill_id IN (SELECT id FROM "bills"
        WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (bill_id IN (SELECT id FROM "bills"
        WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;

ALTER TABLE "bill_comments" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'bill_comments'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "bill_comments"
      USING (bill_id IN (SELECT id FROM "bills"
        WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid))
      WITH CHECK (bill_id IN (SELECT id FROM "bills"
        WHERE organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid));
  END IF;
END $$;
