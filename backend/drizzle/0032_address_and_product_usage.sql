-- 0032 — Customer address (5 fields) + product usage type (retail/salon/both)
-- Migration applied to live user DB on next launch.

ALTER TABLE `clients` ADD `street` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `house_number` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `city` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `country` text;--> statement-breakpoint

ALTER TABLE `inventory_items` ADD `usage_type` text DEFAULT 'salon' NOT NULL;--> statement-breakpoint

-- Backfill usage_type from legacy isRetail flag.
UPDATE `inventory_items` SET `usage_type` = 'retail' WHERE `is_retail` = 1;
