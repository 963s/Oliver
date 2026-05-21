-- §34 Phase 1 — Wochenvorlagen (keine Zeilen pro Kalendertag) + tagesbasierte Ausnahmen.
-- Textzeiten HH:mm werden in der Anwendung in Europe/Berlin interpretiert (Verfügbarkeitsmotor).
-- Sonntag (day_of_week=0): im Motor i. d. R. geschlossen, sofern nicht per open_override (Phase 4).

CREATE TABLE `staff_weekly_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer NOT NULL,
	`day_of_week` integer NOT NULL,
	`is_working` integer DEFAULT true NOT NULL,
	`start_time` text,
	`end_time` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CHECK (`day_of_week` >= 0 AND `day_of_week` <= 6)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_weekly_schedules_staff_dow_uq` ON `staff_weekly_schedules` (`staff_id`, `day_of_week`);
--> statement-breakpoint
CREATE TABLE `calendar_exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exception_date` text NOT NULL,
	`staff_id` integer,
	`exception_type` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CHECK (`exception_type` IN ('closed', 'open_override'))
);
--> statement-breakpoint
CREATE INDEX `calendar_exceptions_date_idx` ON `calendar_exceptions` (`exception_date`);
--> statement-breakpoint
-- Genau ein Eintrag pro (Datum, Geltungsbereich): 0 = gesamter Salon (ifnull(staff_id,0))
CREATE UNIQUE INDEX `calendar_exceptions_date_scope_uq` ON `calendar_exceptions` (`exception_date`, ifnull(`staff_id`, 0));
