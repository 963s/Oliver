-- §12 — CRM / GDPR: structured name, contact, consent, preferences, anonymization marker.
ALTER TABLE `clients` ADD `first_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `clients` ADD `last_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `clients` ADD `email` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `gdpr_consent` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `clients` ADD `gdpr_consent_date` integer;
--> statement-breakpoint
ALTER TABLE `clients` ADD `preferences` text;
--> statement-breakpoint
ALTER TABLE `clients` ADD `anonymized_at` integer;
--> statement-breakpoint
UPDATE `clients` SET `first_name` = TRIM(COALESCE(`name`, '')) WHERE TRIM(COALESCE(`first_name`, '')) = '';
