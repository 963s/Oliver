-- §12.5.14 — Colour formula history (client-linked).
CREATE TABLE `client_formulas` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  `formula_text` text NOT NULL,
  `notes` text,
  `staff_id` integer NOT NULL REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_formulas_client_created_idx` ON `client_formulas` (`client_id`, `created_at`);
--> statement-breakpoint
-- Technical / preference notes (hair profile).
CREATE TABLE `client_notes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  `note_text` text NOT NULL,
  `staff_id` integer NOT NULL REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_notes_client_created_idx` ON `client_notes` (`client_id`, `created_at`);
--> statement-breakpoint
-- §12.5.34 — Reference prices for **non-fiscal** consultation estimates (net cents + VAT bps; gross matches checkout rounding).
ALTER TABLE `salon_service_catalog` ADD `reference_net_cents` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `salon_service_catalog` ADD `vat_rate_bps` integer NOT NULL DEFAULT 1900;
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `reference_net_per_ml_cents` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `estimate_vat_rate_bps` integer NOT NULL DEFAULT 1900;
