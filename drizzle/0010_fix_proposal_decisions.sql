CREATE TABLE `fix_proposal_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text NOT NULL,
  `fix_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `decision` text NOT NULL,
  `comment` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`proposal_id`) REFERENCES `fix_proposal_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`fix_id`) REFERENCES `fixes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fix_proposal_decisions_proposal` ON `fix_proposal_decisions` (`proposal_id`);
--> statement-breakpoint
CREATE INDEX `idx_fix_proposal_decisions_org_created` ON `fix_proposal_decisions` (`organization_id`,`created_at`);
