-- Step 50 — SQLite maintenance cadence (VACUUM at most every N days; ANALYZE on demand).
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('sqlite_maintenance_interval_days', '10');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('sqlite_last_vacuum_at_ms', '');
