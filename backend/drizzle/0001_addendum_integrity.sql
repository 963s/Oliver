ALTER TABLE `orphan_payments` ADD `fiscal_status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `orphan_payments` ADD `fiscal_signed_at` integer;
