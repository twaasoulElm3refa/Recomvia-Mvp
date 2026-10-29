CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'paypal' NOT NULL,
	`event_type` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`status` text DEFAULT 'processed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payment_events_provider_resource` ON `payment_events` (`provider`,`resource_id`);