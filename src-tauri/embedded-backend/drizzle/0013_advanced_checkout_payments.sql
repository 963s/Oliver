-- §12.5.6 / §12.5.7 / §12.5.9 / §12.5.29
ALTER TABLE `invoices` ADD `tip_amount_cents` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `tip_staff_id` integer REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `invoice_kind` text NOT NULL DEFAULT 'normal';
--> statement-breakpoint

CREATE TABLE `invoice_payments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `invoice_id` integer NOT NULL REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
  `amount_cents` integer NOT NULL,
  `method` text NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invoice_payments_invoice_idx` ON `invoice_payments` (`invoice_id`);
--> statement-breakpoint

CREATE TABLE `client_debts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  `source_invoice_id` integer NOT NULL REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
  `amount_cents` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'open',
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_debts_client_idx` ON `client_debts` (`client_id`);
--> statement-breakpoint
CREATE INDEX `client_debts_invoice_idx` ON `client_debts` (`source_invoice_id`);
