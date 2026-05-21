-- §13 (advanced scheduling): appointment metadata + per-staff duration overrides.
ALTER TABLE `appointments` ADD `source_type` text NOT NULL DEFAULT 'internal';
--> statement-breakpoint
ALTER TABLE `appointments` ADD `cancel_reason` text;
--> statement-breakpoint
ALTER TABLE `appointments` ADD `reschedule_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `staff_service_durations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `staff_id` integer NOT NULL REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  `service_name` text NOT NULL,
  `duration_minutes` integer NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_service_durations_staff_service_uq`
  ON `staff_service_durations` (`staff_id`, `service_name`);
