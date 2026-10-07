-- add_batch_id_to_sales_items

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN "batch_id" UUID;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN "batch_id" UUID;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
