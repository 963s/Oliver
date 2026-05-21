-- 0033 — Add missing `active` column to inventory_items (soft-delete flag).
-- This column was declared in schema.ts but never created via migration.
-- DELETE /api/inventory/:id sets active=false; LIST query filters active=true.

ALTER TABLE `inventory_items` ADD `active` integer DEFAULT 1 NOT NULL;
