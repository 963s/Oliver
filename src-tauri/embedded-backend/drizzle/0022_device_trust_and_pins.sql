-- §26 — Trusted POS devices (LAN kiosk pairing). `staff.pin_hash` already exists (migration 0002).

CREATE TABLE `trusted_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_name` text NOT NULL,
	`pairing_token` text,
	`device_token_hash` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_devices_pairing_token_uq` ON `trusted_devices` (`pairing_token`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_devices_device_token_hash_uq` ON `trusted_devices` (`device_token_hash`);
