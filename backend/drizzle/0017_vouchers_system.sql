-- §12.5.2 / §12.5.9 — Gutscheine (vouchers) as payment instrument.
CREATE TABLE `vouchers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL,
  `initial_amount_cents` integer NOT NULL,
  `remaining_amount_cents` integer NOT NULL,
  `is_multi_purpose` integer NOT NULL DEFAULT 1,
  `expiry_date` integer,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vouchers_code_uq` ON `vouchers` (`code`);
--> statement-breakpoint
CREATE INDEX `vouchers_status_idx` ON `vouchers` (`status`);
--> statement-breakpoint
ALTER TABLE `invoice_payments` ADD `voucher_id` integer REFERENCES `vouchers`(`id`) ON UPDATE no action ON DELETE no action;
