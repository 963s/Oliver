CREATE TABLE `appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_name` text NOT NULL,
	`client_phone` text,
	`staff_id` integer NOT NULL,
	`service_name` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_staff_start_idx` ON `appointments` (`staff_id`,`start_at`);
--> statement-breakpoint
CREATE INDEX `appointments_start_idx` ON `appointments` (`start_at`);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `appointment_id` integer REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action;
