CREATE TABLE `subscription_checkout_claims` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`target_plan` text NOT NULL,
	`kind` text NOT NULL,
	`provider_subscription_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TRIGGER `subscriptions_one_active_insert` BEFORE INSERT ON `subscriptions`
WHEN NEW.status = 'active' AND NEW.plan IN ('essential', 'growth', 'pro')
  AND EXISTS (
    SELECT 1 FROM `subscriptions` existing
    WHERE existing.organization_id = NEW.organization_id
      AND existing.status IN ('active', 'suspended', 'payment_failed') AND existing.plan IN ('essential', 'growth', 'pro')
      AND NOT (existing.provider = 'paypal' AND existing.provider_subscription_id = NEW.provider_subscription_id)
  )
BEGIN
  SELECT RAISE(ABORT, 'organization already has an active paid subscription');
END;
--> statement-breakpoint
CREATE TRIGGER `subscriptions_one_active_update` BEFORE UPDATE OF status, plan, organization_id ON `subscriptions`
WHEN NEW.status = 'active' AND NEW.plan IN ('essential', 'growth', 'pro')
  AND EXISTS (
    SELECT 1 FROM `subscriptions` existing
    WHERE existing.organization_id = NEW.organization_id AND existing.id <> OLD.id
      AND existing.status IN ('active', 'suspended', 'payment_failed') AND existing.plan IN ('essential', 'growth', 'pro')
  )
BEGIN
  SELECT RAISE(ABORT, 'organization already has an active paid subscription');
END;
