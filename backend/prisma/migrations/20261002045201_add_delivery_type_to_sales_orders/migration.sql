-- add_delivery_type_to_sales_orders

ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "delivery_type" VARCHAR(50) NOT NULL DEFAULT 'Location';
