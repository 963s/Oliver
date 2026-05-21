-- §13 — Staff overbooking policy, client behavior counters, optional appointment→client link, service duration catalog.
ALTER TABLE `staff` ADD `allow_overbooking` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `staff` ADD `overbooking_max_concurrent` integer NOT NULL DEFAULT 2;
--> statement-breakpoint
ALTER TABLE `clients` ADD `no_show_total` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `clients` ADD `cancel_total` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `client_id` integer REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action;
--> statement-breakpoint
CREATE TABLE `salon_service_catalog` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `service_name` text NOT NULL,
  `duration_minutes` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salon_service_catalog_name_uq` ON `salon_service_catalog` (`service_name`);
--> statement-breakpoint
INSERT INTO `salon_service_catalog` (`service_name`, `duration_minutes`) VALUES
  ('Haarschnitt', 30),
  ('Herrenhaarschnitt', 30),
  ('Färbung', 120),
  ('Strähnen', 90),
  ('Tönung', 60),
  ('Balayage', 150),
  ('Beratung', 15);
