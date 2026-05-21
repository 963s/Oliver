-- §12.5.1 + §12.5.13 + §12.5.46
CREATE TABLE `cash_journal` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `entry_type` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `note` text,
  `staff_id` integer REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cash_journal_created_idx` ON `cash_journal` (`created_at`);
--> statement-breakpoint

CREATE TABLE `daily_closings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `expected_cash_cents` integer NOT NULL,
  `actual_cash_cents` integer NOT NULL,
  `difference_cents` integer NOT NULL,
  `difference_reason` text,
  `snapshot_json` text NOT NULL,
  `closed_by_staff_id` integer NOT NULL REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `daily_closings_created_idx` ON `daily_closings` (`created_at`);
