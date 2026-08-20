-- Rename columns in items table
ALTER TABLE "items" RENAME COLUMN "item_type" TO "item_structure";
ALTER TABLE "items" RENAME COLUMN "type" TO "item_type";

-- Update values for item_type (formerly type)
UPDATE "items" SET "item_type" = 'goods' WHERE "item_type" = 'Goods';
UPDATE "items" SET "item_type" = 'service' WHERE "item_type" = 'Service';

-- Update values for item_structure (formerly item_type)
UPDATE "items" SET "item_structure" = 'single' WHERE "item_structure" = 'Single Item';
UPDATE "items" SET "item_structure" = 'composite' WHERE "item_structure" = 'Composite Item';
UPDATE "items" SET "item_structure" = 'variants' WHERE "item_structure" = 'Contains Variants';
