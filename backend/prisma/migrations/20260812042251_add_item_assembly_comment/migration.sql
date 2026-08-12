-- add_item_assembly_comment

-- CreateTable
CREATE TABLE "item_assembly_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "assembly_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "performed_by" VARCHAR(255),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_assembly_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_assembly_comments_assembly_id_idx" ON "item_assembly_comments"("assembly_id");

-- AddForeignKey
ALTER TABLE "item_assembly_comments" ADD CONSTRAINT "item_assembly_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_assembly_comments" ADD CONSTRAINT "item_assembly_comments_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "item_assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_assembly_comments" ADD CONSTRAINT "item_assembly_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_assembly_comments" ADD CONSTRAINT "item_assembly_comments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS
ALTER TABLE "item_assembly_comments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "item_assembly_comments"
  USING (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
