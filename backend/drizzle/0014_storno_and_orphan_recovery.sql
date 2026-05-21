-- §15 / §36: legal storno linkage + normalized orphan statuses.
ALTER TABLE `invoices` ADD `storno_for_invoice_id` integer REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action;
--> statement-breakpoint
CREATE INDEX `invoices_storno_for_idx` ON `invoices` (`storno_for_invoice_id`);
--> statement-breakpoint

-- Normalize legacy orphan status values for the new API vocabulary.
UPDATE `orphan_payments` SET `status` = 'unresolved' WHERE `status` = 'open';
--> statement-breakpoint
UPDATE `orphan_payments` SET `status` = 'matched' WHERE `status` = 'reconciled';
