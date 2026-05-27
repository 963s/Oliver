-- 0034 — Client Intelligence (Phase 2 of Client Memory Engine).
-- Adds 4 tables that extend the existing clients/clientFormulas/clientNotes
-- with structured hair history, per-visit records, key/value preferences and
-- segmentation tags. All `created_at` / `updated_at` columns store unix ms.
-- §36 GoBD: hair-profile and visit records are referenced from invoices, so
-- they MUST NOT be hard-deleted — soft-delete via deleted_at is added on each
-- table that participates in fiscal data trails.

CREATE TABLE IF NOT EXISTS `client_hair_profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL,
  `natural_color` text,
  `current_color` text,
  `hair_texture` text,
  `hair_condition` text,
  `scalp_condition` text,
  `last_bleach_at` integer,
  `last_perm_at` integer,
  `last_relaxer_at` integer,
  `known_allergies` text,
  `patch_test_result` text,
  `patch_test_notes` text,
  `preferred_style` text,
  `preferred_length` text,
  `updated_by_staff_id` integer,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`updated_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `client_hair_profiles_client_unique` ON `client_hair_profiles` (`client_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `client_visit_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL,
  `session_id` integer,
  `appointment_id` integer,
  `staff_id` integer NOT NULL,
  `visit_date` text NOT NULL,
  `services_performed` text,
  `formula_used` text,
  `formula_id` integer,
  `result_notes` text,
  `client_satisfaction` integer,
  `recommended_next_visit_weeks` integer,
  `next_treatment_notes` text,
  `total_paid_cents` integer,
  `tip_cents` integer,
  `payment_method` text,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`formula_id`) REFERENCES `client_formulas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_visit_records_client_date_idx` ON `client_visit_records` (`client_id`, `visit_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `client_visit_records_session_idx` ON `client_visit_records` (`session_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `client_preferences` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL,
  `category` text NOT NULL,
  `pref_key` text NOT NULL,
  `pref_value` text NOT NULL,
  `set_by_staff_id` integer,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`set_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `client_preferences_client_cat_key_unique` ON `client_preferences` (`client_id`, `category`, `pref_key`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `client_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `client_id` integer NOT NULL,
  `tag` text NOT NULL,
  `set_by_staff_id` integer,
  `note` text,
  `created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`set_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `client_tags_client_tag_unique` ON `client_tags` (`client_id`, `tag`);
