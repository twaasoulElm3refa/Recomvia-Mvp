CREATE TABLE `engine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`provider_run_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`surface_type` text NOT NULL,
	`prompt_id` text NOT NULL,
	`intent` text NOT NULL,
	`prompt` text NOT NULL,
	`language` text NOT NULL,
	`country` text NOT NULL,
	`response_text` text,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`brand_entity` text NOT NULL,
	`brand_visible` integer,
	`mention_count` integer,
	`recommendation_status` text DEFAULT 'unavailable' NOT NULL,
	`recommendation_position` integer,
	`competitors_json` text DEFAULT '[]' NOT NULL,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_micros` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`run_timestamp` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engine_runs_scan_created` ON `engine_runs` (`scan_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_engine_runs_provider_model` ON `engine_runs` (`provider`,`model`);--> statement-breakpoint
CREATE TABLE `scan_contexts` (
	`scan_id` text PRIMARY KEY NOT NULL,
	`brand_name` text NOT NULL,
	`business_description` text NOT NULL,
	`category` text NOT NULL,
	`offerings_json` text DEFAULT '[]' NOT NULL,
	`languages_json` text DEFAULT '[]' NOT NULL,
	`markets_json` text DEFAULT '[]' NOT NULL,
	`intents_json` text DEFAULT '[]' NOT NULL,
	`competitors_json` text DEFAULT '[]' NOT NULL,
	`confidence_json` text DEFAULT '{}' NOT NULL,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `visibility_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`engine_run_id` text NOT NULL,
	`evidence_type` text NOT NULL,
	`entity_name` text,
	`excerpt` text NOT NULL,
	`position` integer,
	`source_url` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`engine_run_id`) REFERENCES `engine_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_visibility_evidence_scan` ON `visibility_evidence` (`scan_id`);--> statement-breakpoint
CREATE INDEX `idx_visibility_evidence_run` ON `visibility_evidence` (`engine_run_id`);--> statement-breakpoint
ALTER TABLE `scans` ADD `actual_visibility_score` integer;--> statement-breakpoint
ALTER TABLE `scans` ADD `actual_visibility_confidence` integer;--> statement-breakpoint
ALTER TABLE `scans` ADD `engine_run_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scans` ADD `context_confidence` integer;