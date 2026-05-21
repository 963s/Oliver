-- §12.5.57 — Legal waiver for chemical / invasive treatments (GoBD-relevant consent trail).
CREATE TABLE `client_waivers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  `waiver_type` text NOT NULL,
  `agreed_at` integer NOT NULL,
  `signature_hash` text NOT NULL,
  `staff_id` integer NOT NULL REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_waivers_client_idx` ON `client_waivers` (`client_id`);
--> statement-breakpoint
CREATE INDEX `client_waivers_type_idx` ON `client_waivers` (`client_id`, `waiver_type`);
--> statement-breakpoint
-- Async hardware work queue (print / terminal); decouples fiscal DB commit from device latency.
CREATE TABLE `hardware_jobs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_type` text NOT NULL,
  `payload_json` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `retry_count` integer NOT NULL DEFAULT 0,
  `error_log` text,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hardware_jobs_status_idx` ON `hardware_jobs` (`status`);
--> statement-breakpoint
CREATE INDEX `hardware_jobs_created_idx` ON `hardware_jobs` (`created_at`);
