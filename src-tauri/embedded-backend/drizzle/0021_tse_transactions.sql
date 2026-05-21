-- §10.12 — Hybrid TSE compliance metadata on invoices (hardware → cloud → Ausfall).
ALTER TABLE `invoices` ADD `tse_transaction_id` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tse_signature_number` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tse_start_time` integer;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tse_end_time` integer;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tse_status` text;
