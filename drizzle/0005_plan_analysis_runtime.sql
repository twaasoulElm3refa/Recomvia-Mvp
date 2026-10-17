CREATE TABLE `monitoring_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_key` text NOT NULL,
	`input_json` text NOT NULL,
	`target_json` text NOT NULL,
	`last_scan_id` text,
	`next_run_at` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`last_status` text,
	`lease_token` text,
	`lease_until` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_monitor_owner_project` ON `monitoring_schedules` (`organization_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `idx_monitor_due` ON `monitoring_schedules` (`state`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `scan_insights` (
	`scan_id` text PRIMARY KEY NOT NULL,
	`details_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `scans` ADD `analysis_plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `scans` ADD `project_key` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `analysis_policy_json` text DEFAULT '{}' NOT NULL;