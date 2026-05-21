-- §14 Invoicing: VAT columns, TSE placeholders, invoice line items.
DELETE FROM `invoices` WHERE `session_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `invoices` RENAME COLUMN `total_cents` TO `total_amount_cents`;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `vat_amount_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `status` text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tse_signature` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tse_export_data` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL;
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_net_cents` integer NOT NULL,
	`vat_rate_bps` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);
--> statement-breakpoint
CREATE INDEX `invoices_session_idx` ON `invoices` (`session_id`);
