CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'stylist' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`barcode_ean` text,
	`barcode_upc` text,
	`default_unit_ml` integer DEFAULT 0 NOT NULL,
	`on_hand_ml` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_barcode_ean_uq` ON `inventory_items` (`barcode_ean`);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_barcode_upc_uq` ON `inventory_items` (`barcode_upc`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`staff_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`estimated_min_price_cents` integer,
	`estimated_max_price_cents` integer,
	`consultation_status` text DEFAULT 'pending' NOT NULL,
	`consultation_approved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_audit_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_run_id` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`period_label` text,
	`closed_at` integer,
	`archive_note` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_audit_runs_audit_run_id_unique` ON `inventory_audit_runs` (`audit_run_id`);
--> statement-breakpoint
CREATE TABLE `inventory_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`audit_run_id` text NOT NULL,
	`inventory_item_id` integer NOT NULL,
	`book_qty_ml` integer NOT NULL,
	`counted_qty_ml` integer NOT NULL,
	`variance_ml` integer NOT NULL,
	`auditor_staff_id` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`auditor_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_audits_run_idx` ON `inventory_audits` (`audit_run_id`);
--> statement-breakpoint
CREATE TABLE `orphan_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`amount_cents` integer NOT NULL,
	`terminal_id` text NOT NULL,
	`zvt_receipt_id` text,
	`authorized_at` integer NOT NULL,
	`raw_payload` text,
	`status` text DEFAULT 'open' NOT NULL,
	`matched_session_id` integer,
	`matched_invoice_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`matched_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer NOT NULL,
	`business_date` text NOT NULL,
	`target_revenue_cents` integer,
	`target_retail_unit_count` integer,
	`progress_revenue_cents` integer DEFAULT 0,
	`progress_retail_units` integer DEFAULT 0,
	`status` text DEFAULT 'open' NOT NULL,
	`bonus_eligible` integer DEFAULT false,
	`bonus_cents` integer,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_targets_staff_date_uq` ON `staff_targets` (`staff_id`,`business_date`);
--> statement-breakpoint
CREATE TABLE `inventory_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inventory_item_id` integer NOT NULL,
	`delta_ml` integer NOT NULL,
	`reason` text NOT NULL,
	`source_audit_id` integer,
	`staff_id` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_audit_id`) REFERENCES `inventory_audits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer,
	`action` text NOT NULL,
	`payload_json` text,
	`reason` text,
	`staff_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity`,`entity_id`);
