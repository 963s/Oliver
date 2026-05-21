-- §12.5.37 (admin-only targets): extend existing staff_targets table.
ALTER TABLE `staff_targets` ADD `target_date` text;
--> statement-breakpoint
ALTER TABLE `staff_targets` ADD `service_target_cents` integer;
--> statement-breakpoint
ALTER TABLE `staff_targets` ADD `retail_target_cents` integer;
--> statement-breakpoint

UPDATE `staff_targets`
SET `target_date` = COALESCE(`target_date`, `business_date`);
--> statement-breakpoint

CREATE INDEX `staff_targets_staff_target_date_idx`
  ON `staff_targets` (`staff_id`, `target_date`);
