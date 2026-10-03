-- stock_adjustment_lines
--
-- Stock adjustment round 2 (docs/STOCK_ADJUSTMENT_ROUND2_PLAN.md): an adjustment
-- becomes a header plus one LINE per item. The item, its quantity, its
-- quantity-before and its cost price move from the header to the line, and each
-- batch row names the line it belongs to.
--
-- Hand-written from the generated draft, which also carried this database's
-- unrelated drift — none of that belongs here.
--
-- @destructive-ok: the four dropped header columns are backfilled into stock_adjustment_lines first (step 2), one line per existing adjustment
--
-- Migrations here are NOT transactional, so every step is safe to re-run and the
-- backfill comes before the constraint that depends on it.

-- 1. The lines table.
CREATE TABLE IF NOT EXISTS "stock_adjustment_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "item_id" UUID NOT NULL,
    "quantity_adjusted" DECIMAL(18,4) NOT NULL,
    "quantity_before" DECIMAL(18,4),
    "cost_price" DECIMAL(18,4),
    "value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "draft_batches" JSONB,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_adjustment_lines_organization_id_adjustment_id_idx" ON "stock_adjustment_lines"("organization_id", "adjustment_id");
CREATE INDEX IF NOT EXISTS "stock_adjustment_lines_organization_id_item_id_idx" ON "stock_adjustment_lines"("organization_id", "item_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_lines_organization_id_fkey') THEN
    ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_lines_adjustment_id_fkey') THEN
    ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_lines_item_id_fkey') THEN
    ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_lines_created_by_fkey') THEN
    ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_lines_updated_by_fkey') THEN
    ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Backfill: one line per existing adjustment, carrying what the header held.
--    Guarded on the old column still being there, so a re-run after step 5 is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'stock_adjustments'
                AND column_name = 'item_id') THEN
    INSERT INTO "stock_adjustment_lines"
      ("organization_id", "adjustment_id", "seq", "item_id", "quantity_adjusted",
       "quantity_before", "cost_price", "value", "created_by", "updated_by",
       "created_at", "updated_at")
    SELECT a."organization_id", a."id", 0, a."item_id", a."quantity_adjusted",
           a."quantity_before", a."cost_price", a."value", a."created_by", a."updated_by",
           a."created_at", a."updated_at"
      FROM "stock_adjustments" a
     WHERE NOT EXISTS (SELECT 1 FROM "stock_adjustment_lines" l WHERE l."adjustment_id" = a."id");
  END IF;
END $$;

-- 3. Each batch row names its line. Nullable first, filled, then required.
ALTER TABLE "stock_adjustment_batches" ADD COLUMN IF NOT EXISTS "line_id" UUID;

UPDATE "stock_adjustment_batches" b
   SET "line_id" = l."id"
  FROM "stock_adjustment_lines" l
 WHERE l."adjustment_id" = b."adjustment_id" AND b."line_id" IS NULL;

ALTER TABLE "stock_adjustment_batches" ALTER COLUMN "line_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "stock_adjustment_batches_organization_id_line_id_idx" ON "stock_adjustment_batches"("organization_id", "line_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_adjustment_batches_line_id_fkey') THEN
    ALTER TABLE "stock_adjustment_batches" ADD CONSTRAINT "stock_adjustment_batches_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "stock_adjustment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. RLS on the new table, before anything else can read it. Direct form: it
--    carries its own organization_id.
ALTER TABLE "stock_adjustment_lines" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'stock_adjustment_lines'
                    AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON "stock_adjustment_lines"
      USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
  END IF;
END $$;

-- 5. The header gives up what the lines now hold.
ALTER TABLE "stock_adjustments" DROP CONSTRAINT IF EXISTS "stock_adjustments_item_id_fkey";
DROP INDEX IF EXISTS "stock_adjustments_organization_id_item_id_adjustment_date_idx";

ALTER TABLE "stock_adjustments"
  DROP COLUMN IF EXISTS "cost_price",
  DROP COLUMN IF EXISTS "item_id",
  DROP COLUMN IF EXISTS "quantity_adjusted",
  DROP COLUMN IF EXISTS "quantity_before";

-- 6. A new adjustment is a draft until it is posted.
ALTER TABLE "stock_adjustments" ALTER COLUMN "status" SET DEFAULT 'draft';
