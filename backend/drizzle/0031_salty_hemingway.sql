CREATE TABLE `appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_name` text NOT NULL,
	`client_phone` text,
	`client_id` integer,
	`staff_id` integer NOT NULL,
	`service_name` text NOT NULL,
	`source_type` text DEFAULT 'internal' NOT NULL,
	`cancel_reason` text,
	`reschedule_count` integer DEFAULT 0 NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text DEFAULT 'booked' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_staff_start_idx` ON `appointments` (`staff_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `appointments_start_idx` ON `appointments` (`start_at`);--> statement-breakpoint
CREATE INDEX `appointments_client_idx` ON `appointments` (`client_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` integer,
	`action` text NOT NULL,
	`before_state_json` text,
	`after_state_json` text,
	`payload_json` text,
	`reason` text,
	`staff_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `calendar_exceptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exception_date` text NOT NULL,
	`staff_id` integer,
	`exception_type` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calendar_exceptions_date_idx` ON `calendar_exceptions` (`exception_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_exceptions_date_scope_uq` ON `calendar_exceptions` (`exception_date`,`ifnull("staff_id"`,` 0)`);--> statement-breakpoint
CREATE TABLE `cash_journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`staff_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_journal_created_idx` ON `cash_journal` (`created_at`);--> statement-breakpoint
CREATE TABLE `client_debts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`source_invoice_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_debts_client_idx` ON `client_debts` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_debts_invoice_idx` ON `client_debts` (`source_invoice_id`);--> statement-breakpoint
CREATE TABLE `client_formulas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`formula_text` text NOT NULL,
	`notes` text,
	`staff_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_formulas_client_created_idx` ON `client_formulas` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_loyalty` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`points_balance` integer DEFAULT 0 NOT NULL,
	`stamps_count` integer DEFAULT 0 NOT NULL,
	`lifetime_points` integer DEFAULT 0 NOT NULL,
	`last_reward_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_loyalty_client_uq` ON `client_loyalty` (`client_id`);--> statement-breakpoint
CREATE TABLE `client_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`note_text` text NOT NULL,
	`staff_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_notes_client_created_idx` ON `client_notes` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_waivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`waiver_type` text NOT NULL,
	`agreed_at` integer NOT NULL,
	`signature_hash` text NOT NULL,
	`staff_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_waivers_client_idx` ON `client_waivers` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_waivers_type_idx` ON `client_waivers` (`client_id`,`waiver_type`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`last_name` text DEFAULT '' NOT NULL,
	`email` text,
	`phone` text,
	`gdpr_consent` integer DEFAULT false NOT NULL,
	`gdpr_consent_date` integer,
	`preferences` text,
	`anonymized_at` integer,
	`patch_test_at` integer,
	`hospitality_drink` text,
	`hospitality_conversation` text,
	`hospitality_seat` text,
	`session_handover_note` text,
	`session_handover_updated_at` integer,
	`no_show_total` integer DEFAULT 0 NOT NULL,
	`cancel_total` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_closings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expected_cash_cents` integer NOT NULL,
	`actual_cash_cents` integer NOT NULL,
	`difference_cents` integer NOT NULL,
	`difference_reason` text,
	`snapshot_json` text NOT NULL,
	`closed_by_staff_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`closed_by_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `daily_closings_created_idx` ON `daily_closings` (`created_at`);--> statement-breakpoint
CREATE TABLE `hardware_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`error_log` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hardware_jobs_status_idx` ON `hardware_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `hardware_jobs_created_idx` ON `hardware_jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inventory_item_id` integer NOT NULL,
	`delta_ml` integer NOT NULL,
	`reason` text NOT NULL,
	`source_audit_id` integer,
	`invoice_id` integer,
	`staff_id` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_audit_id`) REFERENCES `inventory_audits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
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
CREATE UNIQUE INDEX `inventory_audit_runs_audit_run_id_unique` ON `inventory_audit_runs` (`audit_run_id`);--> statement-breakpoint
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
CREATE INDEX `inventory_audits_run_idx` ON `inventory_audits` (`audit_run_id`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`barcode_ean` text,
	`barcode_upc` text,
	`default_unit_ml` integer DEFAULT 0 NOT NULL,
	`on_hand_ml` integer DEFAULT 0 NOT NULL,
	`is_retail` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`min_stock_threshold_ml` integer,
	`reference_net_per_ml_cents` integer DEFAULT 0 NOT NULL,
	`estimate_vat_rate_bps` integer DEFAULT 1900 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_barcode_ean_uq` ON `inventory_items` (`barcode_ean`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_barcode_upc_uq` ON `inventory_items` (`barcode_upc`);--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_net_cents` integer NOT NULL,
	`vat_rate_bps` integer NOT NULL,
	`inventory_item_id` integer,
	`deduct_ml` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`voucher_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_payments_invoice_idx` ON `invoice_payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`total_amount_cents` integer DEFAULT 0 NOT NULL,
	`vat_amount_cents` integer DEFAULT 0 NOT NULL,
	`tip_amount_cents` integer DEFAULT 0 NOT NULL,
	`tip_staff_id` integer,
	`invoice_kind` text DEFAULT 'normal' NOT NULL,
	`storno_for_invoice_id` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`tse_signature` text,
	`tse_export_data` text,
	`tse_transaction_id` text,
	`tse_signature_number` text,
	`tse_start_time` integer,
	`tse_end_time` integer,
	`tse_status` text,
	`zvt_amount_cents` integer,
	`zvt_terminal_id` text,
	`zvt_receipt_id` text,
	`zvt_authorized_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tip_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storno_for_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoices_session_idx` ON `invoices` (`session_id`);--> statement-breakpoint
CREATE TABLE `orphan_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`amount_cents` integer NOT NULL,
	`terminal_id` text NOT NULL,
	`zvt_receipt_id` text,
	`authorized_at` integer NOT NULL,
	`raw_payload` text,
	`status` text DEFAULT 'open' NOT NULL,
	`fiscal_status` text DEFAULT 'pending' NOT NULL,
	`fiscal_signed_at` integer,
	`matched_session_id` integer,
	`matched_invoice_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`matched_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `salon_service_catalog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_name` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`reference_net_cents` integer DEFAULT 0 NOT NULL,
	`vat_rate_bps` integer DEFAULT 1900 NOT NULL,
	`catalog_active` integer DEFAULT true NOT NULL,
	`inventory_item_id` integer,
	`deduct_ml` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salon_service_catalog_service_name_unique` ON `salon_service_catalog` (`service_name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`staff_id` integer NOT NULL,
	`appointment_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`estimated_min_price_cents` integer,
	`estimated_max_price_cents` integer,
	`consultation_status` text DEFAULT 'pending' NOT NULL,
	`consultation_approved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'stylist' NOT NULL,
	`pin_hash` text,
	`active` integer DEFAULT true NOT NULL,
	`allow_overbooking` integer DEFAULT false NOT NULL,
	`overbooking_max_concurrent` integer DEFAULT 2 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_service_durations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer NOT NULL,
	`service_name` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_service_durations_staff_service_uq` ON `staff_service_durations` (`staff_id`,`service_name`);--> statement-breakpoint
CREATE TABLE `staff_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer NOT NULL,
	`target_date` text,
	`business_date` text NOT NULL,
	`service_target_cents` integer,
	`retail_target_cents` integer,
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
CREATE INDEX `staff_targets_staff_date_uq` ON `staff_targets` (`staff_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `staff_weekly_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer NOT NULL,
	`day_of_week` integer NOT NULL,
	`is_working` integer DEFAULT true NOT NULL,
	`start_time` text,
	`end_time` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_weekly_schedules_staff_dow_uq` ON `staff_weekly_schedules` (`staff_id`,`day_of_week`);--> statement-breakpoint
CREATE TABLE `system_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`inventory_item_id` integer NOT NULL,
	`payload_json` text,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inventory_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `system_alerts_kind_item_uq` ON `system_alerts` (`kind`,`inventory_item_id`);--> statement-breakpoint
CREATE INDEX `system_alerts_kind_idx` ON `system_alerts` (`kind`);--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_name` text NOT NULL,
	`pairing_token` text,
	`device_token_hash` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_devices_pairing_token_uq` ON `trusted_devices` (`pairing_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `trusted_devices_device_token_hash_uq` ON `trusted_devices` (`device_token_hash`);--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`initial_amount_cents` integer NOT NULL,
	`remaining_amount_cents` integer NOT NULL,
	`is_multi_purpose` integer DEFAULT true NOT NULL,
	`expiry_date` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch() * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vouchers_code_unique` ON `vouchers` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `vouchers_code_uq` ON `vouchers` (`code`);--> statement-breakpoint
CREATE INDEX `vouchers_status_idx` ON `vouchers` (`status`);