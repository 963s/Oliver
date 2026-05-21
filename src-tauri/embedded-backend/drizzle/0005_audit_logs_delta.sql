-- §15 Detailed audit: first-class before/after JSON columns for GoBD / DSFinV-K traceability.
ALTER TABLE `audit_logs` ADD `before_state_json` text;
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `after_state_json` text;
