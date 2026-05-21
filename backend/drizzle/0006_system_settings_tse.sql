-- §12.0 + Hybrid TSE: local settings for provider switch (Hardware-first, Fiskaly opt-in).
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES
	('tse_provider_type', 'HARDWARE_PRINTER'),
	('fiskaly_enabled', '0');
