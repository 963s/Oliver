-- §10 — Low stock threshold on items + durable system_alerts (one row per kind+item).
ALTER TABLE `inventory_items` ADD `min_stock_threshold_ml` integer;
--> statement-breakpoint
CREATE TABLE `system_alerts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `inventory_item_id` integer NOT NULL,
  `payload_json` text,
  `created_at` integer NOT NULL DEFAULT (cast(unixepoch() * 1000 as integer)),
  FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_alerts_kind_item_uq` ON `system_alerts` (`kind`, `inventory_item_id`);
--> statement-breakpoint
CREATE INDEX `system_alerts_kind_idx` ON `system_alerts` (`kind`);
