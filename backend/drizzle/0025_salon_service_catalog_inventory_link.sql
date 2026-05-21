-- §8 / Step 37.5 — Optional default material draw (inventory ml) per Dienstleistung at checkout.
ALTER TABLE `salon_service_catalog` ADD `inventory_item_id` integer REFERENCES `inventory_items`(`id`);
--> statement-breakpoint
ALTER TABLE `salon_service_catalog` ADD `deduct_ml` integer;
