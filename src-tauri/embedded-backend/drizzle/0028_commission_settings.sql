-- Step 48 — Dynamic commission percentages (basis points; 3000 = 30 % auf Netto-Leistungszeilen).
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('commission_service_bps', '3000');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`, `value`) VALUES ('commission_retail_bps', '1000');
