-- Step 47.1 — Client 360 elite ops: allergen patch test, hospitality, session handover
ALTER TABLE `clients` ADD `patch_test_at` integer;
--> statement-breakpoint
ALTER TABLE `clients` ADD `hospitality_drink` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `hospitality_conversation` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `hospitality_seat` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `session_handover_note` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `session_handover_updated_at` integer;
