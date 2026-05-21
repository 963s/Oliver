ALTER TABLE `staff` ADD `pin_hash` text;
--> statement-breakpoint
ALTER TABLE `staff` ADD `active` integer DEFAULT 1 NOT NULL;
