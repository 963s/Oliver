-- §8 — Invoice lines → inventory ml; adjustments + invoice link; retail flag for negative-stock policy.
ALTER TABLE `invoice_items` ADD `inventory_item_id` integer;
--> statement-breakpoint
ALTER TABLE `invoice_items` ADD `deduct_ml` integer;
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `is_retail` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `inventory_adjustments` ADD `invoice_id` integer REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action;
--> statement-breakpoint
CREATE INDEX `inventory_adjustments_invoice_idx` ON `inventory_adjustments` (`invoice_id`);
