-- Step 49 — Defaults for external fortress backup (schedule = manual until configured).
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('external_backup_schedule', 'manual');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('external_backup_path', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('external_backup_last_ok', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('external_backup_last_detail', '');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('external_backup_last_at_ms', '');
