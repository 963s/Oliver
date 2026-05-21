-- §16: ZVT payment proof on invoice; appointment `completed` after successful checkout.
ALTER TABLE `invoices` ADD `zvt_amount_cents` integer;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `zvt_terminal_id` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `zvt_receipt_id` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `zvt_authorized_at` integer;
