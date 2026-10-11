CREATE TABLE `analysis_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`target_key` text NOT NULL,
	`kind` text NOT NULL,
	`input` text NOT NULL,
	`display_name` text NOT NULL,
	`website_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_analysis_targets_org_key` ON `analysis_targets` (`organization_id`,`target_key`);--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`site_id` text,
	`target_id` text,
	`target_input_json` text DEFAULT '{}' NOT NULL,
	`discovery_json` text,
	`requested_by_user_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`scan_kind` text DEFAULT 'live_readiness' NOT NULL,
	`methodology_version` text NOT NULL,
	`language` text NOT NULL,
	`country` text NOT NULL,
	`readiness_score` integer,
	`actual_visibility_status` text DEFAULT 'not_measured' NOT NULL,
	`actual_visibility_score` integer,
	`actual_visibility_confidence` integer,
	`engine_run_count` integer DEFAULT 0 NOT NULL,
	`context_confidence` integer,
	`confidence` integer,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`critical_count` integer DEFAULT 0 NOT NULL,
	`source_url` text NOT NULL,
	`final_url` text,
	`http_status` integer,
	`cache_key` text NOT NULL,
	`bytes_fetched` integer DEFAULT 0 NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `analysis_targets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scans`("id", "organization_id", "site_id", "target_id", "target_input_json", "discovery_json", "requested_by_user_id", "status", "scan_kind", "methodology_version", "language", "country", "readiness_score", "actual_visibility_status", "actual_visibility_score", "actual_visibility_confidence", "engine_run_count", "context_confidence", "confidence", "issue_count", "critical_count", "source_url", "final_url", "http_status", "cache_key", "bytes_fetched", "request_count", "error_message", "started_at", "completed_at", "created_at") SELECT "id", "organization_id", "site_id", NULL, '{}', NULL, "requested_by_user_id", "status", "scan_kind", "methodology_version", "language", "country", "readiness_score", "actual_visibility_status", "actual_visibility_score", "actual_visibility_confidence", "engine_run_count", "context_confidence", "confidence", "issue_count", "critical_count", "source_url", "final_url", "http_status", "cache_key", "bytes_fetched", "request_count", "error_message", "started_at", "completed_at", "created_at" FROM `scans`;--> statement-breakpoint
DROP TABLE `scans`;--> statement-breakpoint
ALTER TABLE `__new_scans` RENAME TO `scans`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `idx_scans_organization_created` ON `scans` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_scans_site_created` ON `scans` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_scans_cache_status_created` ON `scans` (`cache_key`,`status`,`created_at`);