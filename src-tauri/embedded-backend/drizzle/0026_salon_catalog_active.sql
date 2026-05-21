-- Step 42: hide/disable catalog rows without deleting (GoBD-friendly soft-hide).
ALTER TABLE `salon_service_catalog` ADD COLUMN `catalog_active` integer DEFAULT 1 NOT NULL;
