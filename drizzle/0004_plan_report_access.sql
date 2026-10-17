CREATE TABLE `report_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scan_id` text NOT NULL,
	`plan` text DEFAULT 'starter' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text NOT NULL,
	`provider_payment_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_report_purchases_provider_payment` ON `report_purchases` (`provider`,`provider_payment_id`);--> statement-breakpoint
CREATE INDEX `idx_report_purchases_owner_scan_status` ON `report_purchases` (`organization_id`,`scan_id`,`status`);--> statement-breakpoint
CREATE TABLE `subscription_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_key` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subscription_projects_owner_key` ON `subscription_projects` (`organization_id`,`project_key`);