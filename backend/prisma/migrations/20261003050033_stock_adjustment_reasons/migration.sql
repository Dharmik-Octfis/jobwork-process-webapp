-- stock_adjustment_reasons
--
-- Adjustment reasons stop being a fixed list in code and become each
-- organization's own: added, marked active/inactive, and deleted while unused.
-- `stock_adjustments.reason` (a code such as 'damaged') becomes `reason_id`.
--
-- Hand-written from the generated draft, which also carried this database's
-- unrelated drift — none of that belongs here.
--
-- Migrations here are NOT transactional, so every step is safe to re-run.

-- 1. The table.
CREATE TABLE IF NOT EXISTS "stock_adjustment_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustment_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_adjustment_reasons_organization_id_name_key"
  ON "stock_adjustment_reasons"("organization_id", "name");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_reasons_organization_id_fkey') THEN
    ALTER TABLE "stock_adjustment_reasons" ADD CONSTRAINT "stock_adjustment_reasons_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_reasons_created_by_fkey') THEN
    ALTER TABLE "stock_adjustment_reasons" ADD CONSTRAINT "stock_adjustment_reasons_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_reasons_updated_by_fkey') THEN
    ALTER TABLE "stock_adjustment_reasons" ADD CONSTRAINT "stock_adjustment_reasons_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. RLS — written by hand, `migrate diff` never generates it. Direct form.
ALTER TABLE "stock_adjustment_reasons" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_adjustment_reasons'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_adjustment_reasons"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

-- 3. Every existing organization starts with the reasons the code used to fix.
-- New organizations get the same list from `seedDefaultAdjustmentReasons`.
INSERT INTO "stock_adjustment_reasons" ("organization_id", "name")
SELECT o."id", v.name
FROM "organizations" o
CROSS JOIN (VALUES
  ('Damaged goods'),
  ('Lost or stolen'),
  ('Stock found'),
  ('Stock count correction'),
  ('Write-down to realisable value'),
  ('Cost correction'),
  ('Other')
) AS v(name)
ON CONFLICT ("organization_id", "name") DO NOTHING;

-- 4. The adjustment points at a reason row. Added nullable, backfilled from the
-- old code, then made NOT NULL.
ALTER TABLE "stock_adjustments" ADD COLUMN IF NOT EXISTS "reason_id" UUID;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'stock_adjustments'
                AND column_name = 'reason') THEN
    UPDATE "stock_adjustments" a
    SET "reason_id" = r."id"
    FROM "stock_adjustment_reasons" r
    WHERE a."reason_id" IS NULL
      AND r."organization_id" = a."organization_id"
      AND r."name" = CASE a."reason"
        WHEN 'damaged'          THEN 'Damaged goods'
        WHEN 'lost'             THEN 'Lost or stolen'
        WHEN 'found'            THEN 'Stock found'
        WHEN 'count_correction' THEN 'Stock count correction'
        WHEN 'write_down'       THEN 'Write-down to realisable value'
        WHEN 'cost_correction'  THEN 'Cost correction'
        ELSE 'Other'
      END;
  END IF;
END $$;

ALTER TABLE "stock_adjustments" ALTER COLUMN "reason_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "stock_adjustments_organization_id_reason_id_idx"
  ON "stock_adjustments"("organization_id", "reason_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustments_reason_id_fkey') THEN
    ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_reason_id_fkey"
      FOREIGN KEY ("reason_id") REFERENCES "stock_adjustment_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. The old code column.
-- @destructive-ok: every value is carried into `reason_id` by step 4 before this
-- runs, and the SET NOT NULL above fails first if any row was left unmapped.
-- jobwork_dev held 0 stock adjustments and no approval rule named `reason` on 2026-10-03.
ALTER TABLE "stock_adjustments" DROP COLUMN IF EXISTS "reason";
