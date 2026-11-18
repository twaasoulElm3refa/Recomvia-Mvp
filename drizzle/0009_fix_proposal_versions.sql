CREATE TABLE `fix_proposal_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `fix_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `version` integer NOT NULL,
  `scope` text NOT NULL,
  `proposed_text` text NOT NULL,
  `rationale` text NOT NULL,
  `rollback_plan` text NOT NULL,
  `authored_by_user_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`fix_id`) REFERENCES `fixes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`authored_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fix_proposal_versions_fix_version` ON `fix_proposal_versions` (`fix_id`,`version`);
--> statement-breakpoint
CREATE INDEX `idx_fix_proposal_versions_organization` ON `fix_proposal_versions` (`organization_id`,`created_at`);
