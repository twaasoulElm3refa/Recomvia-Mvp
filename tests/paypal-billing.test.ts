import test from "node:test";
import assert from "node:assert/strict";
import {
  createFixture,
  state,
  userA,
  userB,
} from "./target-runtime-fixture";
import {
  getPayPalBaseUrl,
  getPayPalPlanId,
  getPlanFromPayPalPlanId,
  mapPayPalSubscriptionStatus,
  setPayPalTransport,
  clearPayPalTokenCache,
  STARTER_PRICE_AMOUNT,
  STARTER_CURRENCY,
  STARTER_AMOUNT_CENTS,
  processVerifiedWebhookEvent,
} from "../lib/paypal";
import { database, getEntitlementForUser, getReportForUser } from "../db/product";
import { POST as createOrderRoute } from "../app/api/payments/paypal/create-order/route";
import { POST as captureOrderRoute } from "../app/api/payments/paypal/capture-order/route";
import { POST as createSubscriptionRoute } from "../app/api/payments/paypal/create-subscription/route";
import { POST as syncSubscriptionRoute } from "../app/api/payments/paypal/sync-subscription/route";
import { POST as reviseSubscriptionRoute } from "../app/api/payments/paypal/revise-subscription/route";
import { GET as currentSubscriptionRoute } from "../app/api/payments/paypal/current-subscription/route";
import { POST as webhookRoute } from "../app/api/payments/paypal/webhook/route";
import { isPayPalPaymentsEnabled } from "../lib/paypal/availability";
import { canStartPaidCheckout, isPlanActionDisabled } from "../lib/payment-checkout-ui";

const TEST_CONFIG = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_ENABLED: "true",
  PAYPAL_CLIENT_ID: "test-client-id",
  PAYPAL_CLIENT_SECRET: "test-client-secret",
  PAYPAL_WEBHOOK_ID: "test-webhook-id",
  PAYPAL_ESSENTIAL_PLAN_ID: "P-ESSENTIAL-123",
  PAYPAL_GROWTH_PLAN_ID: "P-GROWTH-456",
  PAYPAL_PRO_PLAN_ID: "P-PRO-789",
};

test("explicit flag and required credentials control checkout without inferring Sandbox readiness", () => {
  assert.equal(isPayPalPaymentsEnabled("starter", { ...TEST_CONFIG, PAYPAL_ENABLED: undefined }), false);
  assert.equal(isPayPalPaymentsEnabled("starter", { ...TEST_CONFIG, PAYPAL_ENABLED: "false" }), false);
  assert.equal(isPayPalPaymentsEnabled("starter", { ...TEST_CONFIG, PAYPAL_CLIENT_SECRET: "" }), false);
  assert.equal(isPayPalPaymentsEnabled("starter", TEST_CONFIG), true);
  assert.equal(isPayPalPaymentsEnabled("growth", TEST_CONFIG), true);
  assert.equal(isPayPalPaymentsEnabled("growth", { ...TEST_CONFIG, PAYPAL_GROWTH_PLAN_ID: "" }), false);
  assert.equal(isPayPalPaymentsEnabled("webhook", { ...TEST_CONFIG, PAYPAL_WEBHOOK_ID: "" }), false);
  assert.equal(canStartPaidCheckout(false, "ready"), false);
  assert.equal(canStartPaidCheckout(null, "loading"), false);
  assert.equal(canStartPaidCheckout(true, "ready"), true);
  assert.equal(canStartPaidCheckout(true, "ready", true), false);
  const available = { starter: true, essential: true, growth: true, pro: true };
  assert.equal(isPlanActionDisabled("starter", available, false, "ready"), true);
  for (const plan of ["essential", "growth", "pro"] as const) assert.equal(isPlanActionDisabled(plan, available, false, "ready"), true);
  assert.equal(isPlanActionDisabled("free", available, false, "ready"), false);
  assert.equal(isPlanActionDisabled("growth", { ...available, growth: false }, true, "ready"), true);
  assert.equal(isPlanActionDisabled("growth", available, true, "ready"), false);
  assert.equal(getPayPalBaseUrl("sandbox"), "https://api-m.sandbox.paypal.com");
  assert.equal(getPayPalBaseUrl("live"), "https://api-m.paypal.com");
});

test("disabled checkout routes return 503 before PayPal calls or local checkout claims while current plan stays readable", async () => {
  const sqlite = createFixture(false, false);
  seedScan(sqlite);
  seedPaidSubscription(sqlite, "I-LOCAL", "essential");
  Object.assign(state.env, TEST_CONFIG, { PAYPAL_ENABLED: "false" });
  state.user = userA;
  let providerCalls = 0;
  setPayPalTransport(async () => { providerCalls++; throw new Error("PayPal transport must not run"); });
  const checks = [
    createOrderRoute(new Request("https://recomvia.test/api/payments/paypal/create-order", { method: "POST", body: JSON.stringify({ scanId: "scan-a" }) })),
    captureOrderRoute(new Request("https://recomvia.test/api/payments/paypal/capture-order", { method: "POST", body: JSON.stringify({ orderId: "ORDER-1", scanId: "scan-a" }) })),
    createSubscriptionRoute(subscriptionRequest("create-subscription", "growth")),
    reviseSubscriptionRoute(subscriptionRequest("revise-subscription", "growth")),
    syncSubscriptionRoute(new Request("https://recomvia.test/api/payments/paypal/sync-subscription", { method: "POST", body: JSON.stringify({ subscriptionId: "I-LOCAL" }) })),
  ];
  for (const response of await Promise.all(checks)) {
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Payments are not available yet.", code: "payment_not_configured" });
  }
  assert.equal(providerCalls, 0);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscription_checkout_claims").get() as any).n, 0);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM report_purchases").get() as any).n, 0);
  const current = await currentSubscriptionRoute();
  assert.equal(current.status, 200);
  const body = await current.json() as any;
  assert.equal(body.currentPlan, "essential");
  assert.equal(body.paymentsEnabled, false);
  assert.deepEqual(body.checkoutAvailability, { starter: false, essential: false, growth: false, pro: false });
  assert.equal(providerCalls, 0);
  Object.assign(state.env, TEST_CONFIG, { PAYPAL_GROWTH_PLAN_ID: "", PAYPAL_WEBHOOK_ID: "" });
  const missingPlan = await createSubscriptionRoute(subscriptionRequest("create-subscription", "growth"));
  assert.equal(missingPlan.status, 503);
  assert.equal((await missingPlan.json() as any).code, "payment_not_configured");
  const availability = await currentSubscriptionRoute();
  const partial = await availability.json() as any;
  assert.equal(partial.paymentsEnabled, true);
  assert.equal(partial.checkoutAvailability.growth, false);
  const missingWebhook = await webhookRoute(new Request("https://recomvia.test/api/payments/paypal/webhook", { method: "POST", body: "{}" }));
  assert.equal(missingWebhook.status, 503);
  assert.equal(providerCalls, 0);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscription_checkout_claims").get() as any).n, 0);
  sqlite.close();
});

function seedUserAndOrg(sqlite: any) {
  sqlite.exec(`
    INSERT INTO users (id, email, display_name)
    VALUES ('${userA.userId}', '${userA.email}', '${userA.displayName}')
    ON CONFLICT(id) DO NOTHING;

    INSERT INTO organizations (id, name, owner_user_id)
    VALUES ('org-target-test-a', 'Test workspace', '${userA.userId}')
    ON CONFLICT(id) DO NOTHING;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES ('org-target-test-a', '${userA.userId}', 'owner')
    ON CONFLICT(organization_id, user_id) DO NOTHING;
  `);
}

function seedScan(sqlite: any, scanId = "scan-a", orgId = "org-target-test-a", userId = userA.userId, status = "completed") {
  seedUserAndOrg(sqlite);
  sqlite.exec(`
    INSERT INTO scans (id, organization_id, site_id, requested_by_user_id, status, source_url, cache_key, methodology_version, language, country)
    VALUES ('${scanId}', '${orgId}', null, '${userId}', '${status}', 'https://example.com', 'key-${scanId}', 'test', 'en', 'US')
    ON CONFLICT(id) DO UPDATE SET status = excluded.status;
  `);
}

function seedSecondOrg(sqlite: any) {
  sqlite.exec(`
    INSERT INTO users (id, email, display_name)
    VALUES ('${userB.userId}', '${userB.email}', '${userB.displayName}')
    ON CONFLICT(id) DO NOTHING;

    INSERT INTO organizations (id, name, owner_user_id)
    VALUES ('org-b', 'Workspace B', '${userB.userId}')
    ON CONFLICT(id) DO NOTHING;

    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES ('org-b', '${userB.userId}', 'owner')
    ON CONFLICT(organization_id, user_id) DO NOTHING;
  `);
}

function seedPaidSubscription(sqlite: any, id: string, plan: "essential" | "growth" | "pro", status = "active", updatedAt = "2026-10-29 12:00:00") {
  seedUserAndOrg(sqlite);
  sqlite.prepare(`INSERT INTO subscriptions (id, organization_id, plan, status, provider, provider_subscription_id, current_period_end, updated_at)
    VALUES (?, 'org-target-test-a', ?, ?, 'paypal', ?, '2099-01-01T00:00:00Z', ?)`)
    .run(`row-${id}`, plan, status, id, updatedAt);
}

function subscriptionRequest(route: string, plan: string) {
  return new Request(`https://recomvia.test/api/payments/paypal/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }),
  });
}

test("PayPal URL selection keeps Sandbox and requires an explicit Live environment", () => {
  assert.equal(getPayPalBaseUrl("sandbox"), "https://api-m.sandbox.paypal.com");
  assert.equal(getPayPalBaseUrl("live"), "https://api-m.paypal.com");
  assert.equal(getPayPalBaseUrl("production"), "https://api-m.paypal.com");
  assert.throws(() => getPayPalBaseUrl("unknown"), /Unsupported PAYPAL_ENV/);
});

test("Subscription plans map correctly and reject arbitrary/invalid plans", () => {
  assert.equal(getPayPalPlanId("essential", TEST_CONFIG), "P-ESSENTIAL-123");
  assert.equal(getPayPalPlanId("growth", TEST_CONFIG), "P-GROWTH-456");
  assert.equal(getPayPalPlanId("pro", TEST_CONFIG), "P-PRO-789");

  assert.throws(() => getPayPalPlanId("free", TEST_CONFIG), /Invalid subscription plan/);
  assert.throws(() => getPayPalPlanId("starter", TEST_CONFIG), /Invalid subscription plan/);
  assert.throws(() => getPayPalPlanId("arbitrary_plan", TEST_CONFIG), /Invalid subscription plan/);

  assert.equal(getPlanFromPayPalPlanId("P-ESSENTIAL-123", TEST_CONFIG), "essential");
  assert.equal(getPlanFromPayPalPlanId("P-GROWTH-456", TEST_CONFIG), "growth");
  assert.equal(getPlanFromPayPalPlanId("P-PRO-789", TEST_CONFIG), "pro");
  assert.equal(getPlanFromPayPalPlanId("P-UNKNOWN-999", TEST_CONFIG), null);
});

test("Subscription status mapping centralizes all PayPal statuses into Recomvia entitlements", () => {
  assert.deepEqual(mapPayPalSubscriptionStatus("ACTIVE"), { internalStatus: "active", isActive: true });
  assert.deepEqual(mapPayPalSubscriptionStatus("CANCELLED"), { internalStatus: "cancelled", isActive: false });
  assert.deepEqual(mapPayPalSubscriptionStatus("SUSPENDED"), { internalStatus: "suspended", isActive: false });
  assert.deepEqual(mapPayPalSubscriptionStatus("EXPIRED"), { internalStatus: "expired", isActive: false });
  assert.deepEqual(mapPayPalSubscriptionStatus("PAYMENT_FAILED"), { internalStatus: "payment_failed", isActive: false });
  assert.deepEqual(mapPayPalSubscriptionStatus("APPROVAL_PENDING"), { internalStatus: "inactive", isActive: false });
  assert.deepEqual(mapPayPalSubscriptionStatus("APPROVED"), { internalStatus: "inactive", isActive: false });
});

test("Starter Order Creation: requires auth, enforces scan ownership, and fixes amount to $4.99", async () => {
  const sqlite = createFixture(false, false);
  seedScan(sqlite, "scan-a", "org-target-test-a", userA.userId, "completed");
  seedSecondOrg(sqlite);
  seedScan(sqlite, "scan-b", "org-b", userB.userId, "completed");

  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();

  let capturedRequestBody: any = null;
  setPayPalTransport(async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes("/v2/checkout/orders")) {
      capturedRequestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "ORDER-12345",
          status: "CREATED",
          links: [{ href: "https://sandbox.paypal.com/checkout?token=ORDER-12345", rel: "approve" }],
        }),
        { status: 201 },
      );
    }
    return new Response("Not found", { status: 404 });
  });

  // 1. Unauthenticated request rejected
  state.user = null;
  const unauthRes = await createOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: "scan-a" }),
    }),
  );
  assert.equal(unauthRes.status, 401);

  // 2. Authenticated user A
  state.user = userA;

  // 3. Trying to order scan owned by org-b is rejected with 404
  const forbiddenRes = await createOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: "scan-b" }),
    }),
  );
  assert.equal(forbiddenRes.status, 404);

  // 4. Client passing custom price cannot alter server fixed price $4.99
  const successRes = await createOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: "scan-a", price: "0.99", amount: "1.00" }),
    }),
  );
  assert.equal(successRes.status, 200);
  const data = await successRes.json() as { orderId: string; approveUrl: string };
  assert.equal(data.orderId, "ORDER-12345");
  assert.ok(data.approveUrl.includes("ORDER-12345"));

  // Verify server fixed amount to $4.99 USD
  assert.equal(capturedRequestBody.purchase_units[0].amount.value, STARTER_PRICE_AMOUNT);
  assert.equal(capturedRequestBody.purchase_units[0].amount.currency_code, STARTER_CURRENCY);
  assert.equal(capturedRequestBody.purchase_units[0].custom_id, "org-target-test-a:scan-a");

  // Verify a pending record was stored
  const pending = sqlite
    .prepare("SELECT * FROM report_purchases WHERE provider_payment_id = 'ORDER-12345'")
    .get() as any;
  assert.ok(pending);
  assert.equal(pending.status, "pending");
  assert.equal(pending.amount_cents, 499);

  sqlite.close();
});

test("Starter Order Capture: unlocks target report, enforces $4.99 amount, cross-org guard, and idempotency", async () => {
  const sqlite = createFixture(false, false);
  seedScan(sqlite, "scan-a", "org-target-test-a", userA.userId, "completed");
  seedSecondOrg(sqlite);

  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();

  let captureReturnStatus = "COMPLETED";
  let captureAmountValue = "4.99";
  let captureCurrency = "USD";
  let captureCustomId = "org-target-test-a:scan-a";

  setPayPalTransport(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes("/capture")) {
      return new Response(
        JSON.stringify({
          id: "ORDER-CAPTURE-123",
          status: captureReturnStatus,
          purchase_units: [
            {
              amount: { currency_code: captureCurrency, value: captureAmountValue },
              custom_id: captureCustomId,
              payments: {
                captures: [
                  {
                    id: "CAP-999",
                    status: captureReturnStatus,
                    amount: { currency_code: captureCurrency, value: captureAmountValue },
                    custom_id: captureCustomId,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("Not found", { status: 404 });
  });

  state.user = userA;

  // 1. Wrong currency rejected
  captureCurrency = "EUR";
  const eurRes = await captureOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "ORDER-CAPTURE-123", scanId: "scan-a" }),
    }),
  );
  assert.equal(eurRes.status, 400);
  captureCurrency = "USD";

  // 2. Wrong amount ($1.00 instead of $4.99) rejected
  captureAmountValue = "1.00";
  const wrongAmountRes = await captureOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "ORDER-CAPTURE-123", scanId: "scan-a" }),
    }),
  );
  assert.equal(wrongAmountRes.status, 400);
  captureAmountValue = "4.99";

  // 3. Successful capture for User A
  const successRes = await captureOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "ORDER-CAPTURE-123", scanId: "scan-a" }),
    }),
  );
  assert.equal(successRes.status, 200);
  const successData = await successRes.json() as any;
  assert.equal(successData.success, true);
  assert.equal(successData.scanId, "scan-a");

  // 4. Verify report is now unlocked for user A with starter entitlement
  const reportA = await getReportForUser(userA.userId, "scan-a");
  assert.ok(reportA);
  assert.equal(reportA.entitlement.reportLevel, "starter");
  assert.equal(reportA.entitlement.canViewStarterReport, true);
  assert.equal(reportA.entitlement.canViewFullReport, false);

  // 5. Cross-account protection: User B from org-b cannot access User A's purchased report
  const reportB = await getReportForUser(userB.userId, "scan-a");
  assert.equal(reportB, null);

  // 6. User B trying to capture order for their own org fails ownership check
  state.user = userB;
  const stolenRes = await captureOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "ORDER-CAPTURE-123", scanId: "scan-a" }),
    }),
  );
  assert.equal(stolenRes.status, 403);

  // 7. Duplicate capture by User A is idempotent and returns alreadyProcessed
  state.user = userA;
  const dupRes = await captureOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/capture-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "ORDER-CAPTURE-123", scanId: "scan-a" }),
    }),
  );
  assert.equal(dupRes.status, 200);
  const dupData = await dupRes.json() as any;
  assert.equal(dupData.alreadyProcessed, true);

  sqlite.close();
});

test("Subscription creation and sync: plan mapping, rejecting arbitrary plans, and server-verified activation", async () => {
  const sqlite = createFixture(false, false);
  seedUserAndOrg(sqlite);
  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();

  let capturedSubBody: any = null;
  let mockSubStatus = "ACTIVE";
  let mockPlanId = "P-ESSENTIAL-123";

  setPayPalTransport(async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes("/v1/billing/subscriptions") && init?.method === "POST") {
      capturedSubBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: "I-SUB-12345",
          status: "APPROVAL_PENDING",
          links: [{ href: "https://sandbox.paypal.com/subscribe?ba_token=I-SUB-12345", rel: "approve" }],
        }),
        { status: 201 },
      );
    }
    if (urlStr.includes("/v1/billing/subscriptions/I-SUB-12345") && (!init || init.method === "GET")) {
      return new Response(
        JSON.stringify({
          id: "I-SUB-12345",
          status: mockSubStatus,
          plan_id: mockPlanId,
          custom_id: "org-target-test-a:essential",
          billing_info: { next_billing_time: "2099-01-01T00:00:00Z" },
        }),
        { status: 200 },
      );
    }
    return new Response("Not found", { status: 404 });
  });

  state.user = userA;

  // 1. Rejects invalid / arbitrary plans
  const invalidPlanRes = await createSubscriptionRoute(
    new Request("https://recomvia.test/api/payments/paypal/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "arbitrary_custom_plan", plan_id: "P-HACKED", price: 1 }),
    }),
  );
  assert.equal(invalidPlanRes.status, 400);

  // 2. Essential maps strictly to PAYPAL_ESSENTIAL_PLAN_ID
  const essentialRes = await createSubscriptionRoute(
    new Request("https://recomvia.test/api/payments/paypal/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "essential" }),
    }),
  );
  assert.equal(essentialRes.status, 200);
  assert.equal(capturedSubBody.plan_id, "P-ESSENTIAL-123");
  assert.equal(capturedSubBody.custom_id, "org-target-test-a:essential");

  // Verify created subscription is INACTIVE in database before PayPal activation
  const subRow = sqlite
    .prepare("SELECT * FROM subscriptions WHERE provider_subscription_id = 'I-SUB-12345'")
    .get() as any;
  assert.equal(subRow.status, "inactive");

  // 3. Sync subscription: verified as ACTIVE on PayPal
  mockSubStatus = "ACTIVE";
  mockPlanId = "P-ESSENTIAL-123";
  const syncRes = await syncSubscriptionRoute(
    new Request("https://recomvia.test/api/payments/paypal/sync-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId: "I-SUB-12345" }),
    }),
  );
  assert.equal(syncRes.status, 200);
  const syncData = await syncRes.json() as any;
  assert.equal(syncData.status, "active");
  assert.equal(syncData.isActive, true);

  // Verify DB updated to active
  const activeSub = sqlite
    .prepare("SELECT * FROM subscriptions WHERE provider_subscription_id = 'I-SUB-12345'")
    .get() as any;
  assert.equal(activeSub.status, "active");

  // 4. If PayPal reports CANCELLED, sync revokes entitlement
  mockSubStatus = "CANCELLED";
  const cancelSyncRes = await syncSubscriptionRoute(
    new Request("https://recomvia.test/api/payments/paypal/sync-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId: "I-SUB-12345" }),
    }),
  );
  assert.equal(cancelSyncRes.status, 200);
  const cancelData = await cancelSyncRes.json() as any;
  assert.equal(cancelData.status, "cancelled");
  assert.equal(cancelData.isActive, false);

  sqlite.close();
});

test("PayPal Webhook: verification required, invalid rejected, event idempotency guaranteed", async () => {
  const sqlite = createFixture(false, false);
  seedScan(sqlite, "scan-a", "org-target-test-a", userA.userId, "completed");

  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();

  let verificationResult = "SUCCESS";

  setPayPalTransport(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes("/verify-webhook-signature")) {
      return new Response(JSON.stringify({ verification_status: verificationResult }), { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  });

  const validHeaders = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "trans-123",
    "paypal-transmission-sig": "signature-abc",
    "paypal-transmission-time": "2026-10-29T12:00:00Z",
    "Content-Type": "application/json",
  };

  const webhookPayload = {
    id: "WH-EVENT-999",
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource_type: "subscription",
    resource: {
      id: "I-SUB-WEBHOOK-1",
      plan_id: "P-GROWTH-456",
      status: "ACTIVE",
      custom_id: "org-target-test-a:growth",
      billing_info: { next_billing_time: "2099-01-01T00:00:00Z" },
    },
  };

  // 1. Missing signature headers -> 400 rejected
  const missingHeadersRes = await webhookRoute(
    new Request("https://recomvia.test/api/payments/paypal/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    }),
  );
  assert.equal(missingHeadersRes.status, 400);

  // 2. PayPal verification endpoint returns FAILURE -> 400 rejected
  verificationResult = "FAILURE";
  const failedSigRes = await webhookRoute(
    new Request("https://recomvia.test/api/payments/paypal/webhook", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify(webhookPayload),
    }),
  );
  assert.equal(failedSigRes.status, 400);

  // 3. Valid signature -> processed successfully
  verificationResult = "SUCCESS";
  const validRes = await webhookRoute(
    new Request("https://recomvia.test/api/payments/paypal/webhook", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify(webhookPayload),
    }),
  );
  assert.equal(validRes.status, 200);
  const validData = await validRes.json() as any;
  assert.equal(validData.received, true);
  assert.equal(validData.processed, true);
  assert.equal(validData.duplicate, false);

  // Verify subscription became active Growth
  const sub = sqlite
    .prepare("SELECT * FROM subscriptions WHERE provider_subscription_id = 'I-SUB-WEBHOOK-1'")
    .get() as any;
  assert.equal(sub.plan, "growth");
  assert.equal(sub.status, "active");

  // 4. Duplicate webhook delivery of the same event ID is idempotent
  const duplicateRes = await webhookRoute(
    new Request("https://recomvia.test/api/payments/paypal/webhook", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify(webhookPayload),
    }),
  );
  assert.equal(duplicateRes.status, 200);
  const dupData = await duplicateRes.json() as any;
  assert.equal(dupData.duplicate, true);
  assert.equal(dupData.processed, false);

  // 5. Webhook capture event PAYMENT.CAPTURE.COMPLETED unlocks Starter
  const capturePayload = {
    id: "WH-EVENT-CAPTURE-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource_type: "capture",
    resource: {
      id: "CAP-WH-1",
      custom_id: "org-target-test-a:scan-a",
      amount: { value: "4.99", currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: "ORDER-WH-1" } },
    },
  };

  const capRes = await webhookRoute(
    new Request("https://recomvia.test/api/payments/paypal/webhook", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify(capturePayload),
    }),
  );
  assert.equal(capRes.status, 200);

  const purchaseRow = sqlite
    .prepare("SELECT * FROM report_purchases WHERE provider_payment_id = 'ORDER-WH-1'")
    .get() as any;
  assert.ok(purchaseRow);
  assert.equal(purchaseRow.status, "paid");

  // 6. Webhook capture event PAYMENT.CAPTURE.REFUNDED locks Starter again
  const refundPayload = {
    id: "WH-EVENT-REFUND-1",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource_type: "capture",
    resource: {
      id: "CAP-WH-1",
      supplementary_data: { related_ids: { order_id: "ORDER-WH-1" } },
    },
  };

  const refundRes = await webhookRoute(
    new Request("https://recomvia.test/api/payments/paypal/webhook", {
      method: "POST",
      headers: validHeaders,
      body: JSON.stringify(refundPayload),
    }),
  );
  assert.equal(refundRes.status, 200);

  const refundedRow = sqlite
    .prepare("SELECT * FROM report_purchases WHERE provider_payment_id = 'ORDER-WH-1'")
    .get() as any;
  assert.equal(refundedRow.status, "refunded");

  sqlite.close();
});

test("active Essential, Growth, and Pro block same-plan checkout and require revision for every other plan", async () => {
  for (const current of ["essential", "growth", "pro"] as const) {
    const sqlite = createFixture(false, false);
    seedPaidSubscription(sqlite, `I-${current}`, current);
    state.user = userA;
    setPayPalTransport(async () => { throw new Error("A guarded checkout must not call PayPal"); });
    const currentResponse = await currentSubscriptionRoute();
    assert.equal((await currentResponse.json() as any).currentPlan, current);
    for (const target of ["essential", "growth", "pro"] as const) {
      const response = await createSubscriptionRoute(subscriptionRequest("create-subscription", target));
      assert.equal(response.status, 409);
      const data = await response.json() as any;
      assert.equal(data.code, target === current ? "already_active" : "plan_change_required");
      assert.equal(data.currentPlan, current);
    }
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions").get() as any).n, 1);
    sqlite.close();
  }
});

test("plan changes revise the same PayPal agreement and retain the old entitlement pending consent", async () => {
  const transitions = [
    ["essential", "growth"], ["essential", "pro"], ["growth", "pro"],
    ["growth", "essential"], ["pro", "growth"], ["pro", "essential"],
  ] as const;
  for (const [current, target] of transitions) {
    const sqlite = createFixture(false, false);
    seedPaidSubscription(sqlite, "I-EXISTING", current);
    Object.assign(state.env, TEST_CONFIG);
    clearPayPalTokenCache();
    state.user = userA;
    let reviseCalls = 0;
    let paypalPlan: "essential" | "growth" | "pro" = current;
    let paypalStatus = "ACTIVE";
    setPayPalTransport(async (url, init) => {
      const path = String(url);
      if (path.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
      if (path.endsWith("/I-EXISTING/revise")) {
        reviseCalls += 1;
        assert.equal(init?.method, "POST");
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.plan_id, getPayPalPlanId(target, TEST_CONFIG));
        assert.match(payload.application_context.return_url, /subscription_id=I-EXISTING/);
        return Response.json({ links: [{ rel: "approve", href: "https://sandbox.paypal.com/approve-revision" }] });
      }
      if (path.endsWith("/I-EXISTING")) return Response.json({ id: "I-EXISTING", status: paypalStatus, plan_id: getPayPalPlanId(paypalPlan, TEST_CONFIG), custom_id: `org-target-test-a:${current}`, billing_info: { next_billing_time: "2099-01-01T00:00:00Z" } });
      throw new Error(`Unexpected PayPal request: ${path}`);
    });
    const response = await reviseSubscriptionRoute(subscriptionRequest("revise-subscription", target));
    assert.equal(response.status, 200);
    const data = await response.json() as any;
    assert.equal(data.subscriptionId, "I-EXISTING");
    assert.equal(data.approveUrl, "https://sandbox.paypal.com/approve-revision");
    assert.equal(reviseCalls, 1);
    const row = sqlite.prepare("SELECT plan, status FROM subscriptions WHERE provider_subscription_id = 'I-EXISTING'").get() as any;
    assert.deepEqual([row.plan, row.status], [current, "active"]);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions").get() as any).n, 1);
    paypalStatus = "APPROVAL_PENDING";
    const pending = await syncSubscriptionRoute(new Request("https://recomvia.test/api/payments/paypal/sync-subscription", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: "I-EXISTING" }),
    }));
    assert.equal((await pending.json() as any).pendingPlanChange, true);
    assert.equal((sqlite.prepare("SELECT plan FROM subscriptions WHERE provider_subscription_id='I-EXISTING'").get() as any).plan, current);
    paypalStatus = "ACTIVE";
    paypalPlan = target;
    const approved = await syncSubscriptionRoute(new Request("https://recomvia.test/api/payments/paypal/sync-subscription", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: "I-EXISTING" }),
    }));
    assert.equal((await approved.json() as any).isActive, true);
    assert.equal((sqlite.prepare("SELECT plan FROM subscriptions WHERE provider_subscription_id='I-EXISTING'").get() as any).plan, target);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE status='active'").get() as any).n, 1);
    sqlite.close();
  }
});

test("abandoned inactive rows do not block checkout; a second pending checkout is claimed once", async () => {
  const sqlite = createFixture(false, false);
  seedPaidSubscription(sqlite, "I-ABANDONED", "essential", "inactive");
  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();
  state.user = userA;
  let creations = 0;
  setPayPalTransport(async (url) => {
    const path = String(url);
    if (path.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
    if (path.endsWith("/v1/billing/subscriptions")) {
      creations += 1;
      return Response.json({ id: "I-NEW", status: "APPROVAL_PENDING", links: [{ rel: "approve", href: "https://sandbox.paypal.com/new" }] }, { status: 201 });
    }
    throw new Error(`Unexpected PayPal request: ${path}`);
  });
  const first = await createSubscriptionRoute(subscriptionRequest("create-subscription", "growth"));
  assert.equal(first.status, 200);
  const second = await createSubscriptionRoute(subscriptionRequest("create-subscription", "pro"));
  assert.equal(second.status, 409);
  assert.equal((await second.json() as any).code, "checkout_in_progress");
  assert.equal(creations, 1);
  assert.equal((sqlite.prepare("SELECT status FROM subscriptions WHERE provider_subscription_id='I-ABANDONED'").get() as any).status, "inactive");
  sqlite.close();
});

test("historical active rows yield one latest verified entitlement and block new checkout", async () => {
  const sqlite = createFixture(false, false);
  // Simulate duplicate rows written before migration 0007 installed its trigger.
  sqlite.exec("DROP TRIGGER subscriptions_one_active_insert; DROP TRIGGER subscriptions_one_active_update;");
  seedPaidSubscription(sqlite, "I-OLD-PRO", "pro", "active", "2026-10-29 10:00:00");
  seedPaidSubscription(sqlite, "I-NEW-ESSENTIAL", "essential", "active", "2026-10-29 11:00:00");
  Object.assign(state.env, TEST_CONFIG);
  state.user = userA;
  const entitlement = await getEntitlementForUser(userA);
  assert.equal(entitlement.planId, "essential");
  assert.equal(entitlement.projectLimit, 1);
  assert.equal(entitlement.canViewAdvancedReport, false);
  const current = await currentSubscriptionRoute();
  assert.equal((await current.json() as any).billingConflict, true);
  const checkout = await createSubscriptionRoute(subscriptionRequest("create-subscription", "growth"));
  assert.equal((await checkout.json() as any).code, "billing_conflict");
  sqlite.close();
});

test("database triggers prevent a second active paid row while allowing inactive audit rows", () => {
  const sqlite = createFixture(false, false);
  seedPaidSubscription(sqlite, "I-FIRST", "essential");
  seedPaidSubscription(sqlite, "I-ABANDONED", "growth", "inactive");
  assert.throws(() => seedPaidSubscription(sqlite, "I-SECOND", "pro"), /organization already has an active paid subscription/);
  assert.throws(() => sqlite.prepare("UPDATE subscriptions SET status='active' WHERE provider_subscription_id='I-ABANDONED'").run(), /organization already has an active paid subscription/);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE status='active'").get() as any).n, 1);
  sqlite.close();
});

test("conflicting activation webhook cancels the new PayPal agreement and remains idempotent", async () => {
  const sqlite = createFixture(false, false);
  seedPaidSubscription(sqlite, "I-KEEP", "essential", "active");
  seedPaidSubscription(sqlite, "I-CONFLICT", "growth", "inactive");
  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();
  let cancellations = 0;
  setPayPalTransport(async (url, init) => {
    const path = String(url);
    if (path.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
    if (path.endsWith("/verify-webhook-signature")) return Response.json({ verification_status: "SUCCESS" });
    if (path.endsWith("/I-CONFLICT/cancel")) { cancellations += 1; assert.equal(init?.method, "POST"); return new Response(null, { status: 204 }); }
    if (path.endsWith("/I-CONFLICT")) return Response.json({ id: "I-CONFLICT", status: "CANCELLED", plan_id: TEST_CONFIG.PAYPAL_GROWTH_PLAN_ID });
    throw new Error(`Unexpected PayPal request: ${path}`);
  });
  const event = {
    id: "WH-CONFLICT-1", event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource_type: "subscription",
    resource: { id: "I-CONFLICT", status: "ACTIVE", plan_id: TEST_CONFIG.PAYPAL_GROWTH_PLAN_ID, custom_id: "org-target-test-a:growth" },
  };
  const headers = {
    "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "conflict-transmission", "paypal-transmission-sig": "signed",
    "paypal-transmission-time": "2026-10-29T12:00:00Z", "Content-Type": "application/json",
  };
  const send = () => webhookRoute(new Request("https://recomvia.test/api/payments/paypal/webhook", { method: "POST", headers, body: JSON.stringify(event) }));
  const first = await send();
  assert.equal(first.status, 200);
  assert.equal((await first.json() as any).action, "subscription_conflict_cancelled");
  const rows = sqlite.prepare("SELECT provider_subscription_id AS id, status FROM subscriptions ORDER BY id").all() as any[];
  assert.deepEqual(rows.map((row) => [row.id, row.status]).sort(), [["I-CONFLICT", "cancelled"], ["I-KEEP", "active"]]);
  const duplicate = await send();
  assert.equal((await duplicate.json() as any).duplicate, true);
  assert.equal(cancellations, 1);
  sqlite.close();
});

test("webhook cancellation, suspension, expiry, and payment failure revoke access without deleting history", async () => {
  const cases = [
    ["BILLING.SUBSCRIPTION.CANCELLED", "cancelled"],
    ["BILLING.SUBSCRIPTION.SUSPENDED", "suspended"],
    ["BILLING.SUBSCRIPTION.EXPIRED", "expired"],
    ["BILLING.SUBSCRIPTION.PAYMENT.FAILED", "payment_failed"],
  ] as const;
  for (const [eventType, status] of cases) {
    const sqlite = createFixture(false, false);
    seedPaidSubscription(sqlite, "I-LIFECYCLE", "growth");
    Object.assign(state.env, TEST_CONFIG);
    const event = { id: `WH-${status}`, event_type: eventType, resource_type: "subscription", resource: { id: "I-LIFECYCLE" } };
    const first = await processVerifiedWebhookEvent(database(), event);
    assert.equal(first.processed, true);
    assert.equal((sqlite.prepare("SELECT status FROM subscriptions WHERE provider_subscription_id='I-LIFECYCLE'").get() as any).status, status);
    assert.equal((await getEntitlementForUser(userA)).planId, null);
    const current = await currentSubscriptionRoute();
    const currentData = await current.json() as any;
    assert.equal(currentData.billingReview, status === "suspended" || status === "payment_failed");
    if (currentData.billingReview) {
      const guarded = await createSubscriptionRoute(subscriptionRequest("create-subscription", "pro"));
      assert.equal((await guarded.json() as any).code, "subscription_review_required");
    }
    const repeated = await processVerifiedWebhookEvent(database(), event);
    assert.equal(repeated.duplicate, true);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions").get() as any).n, 1);
    sqlite.close();
  }
});

test("pending revision webhooks preserve the current plan and late sales cannot revive cancelled plans", async () => {
  const sqlite = createFixture(false, false);
  seedPaidSubscription(sqlite, "I-LIFECYCLE", "essential");
  Object.assign(state.env, TEST_CONFIG);
  const pending = await processVerifiedWebhookEvent(database(), {
    id: "WH-PENDING-REVISE", event_type: "BILLING.SUBSCRIPTION.UPDATED", resource_type: "subscription",
    resource: { id: "I-LIFECYCLE", status: "APPROVAL_PENDING", plan_id: TEST_CONFIG.PAYPAL_GROWTH_PLAN_ID },
  });
  assert.equal(pending.processed, true);
  const pendingRow = sqlite.prepare("SELECT plan,status FROM subscriptions WHERE provider_subscription_id='I-LIFECYCLE'").get() as any;
  assert.deepEqual([pendingRow.plan, pendingRow.status], ["essential", "active"]);
  await processVerifiedWebhookEvent(database(), { id: "WH-CANCEL-LATE", event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource_type: "subscription", resource: { id: "I-LIFECYCLE" } });
  const lateSale = await processVerifiedWebhookEvent(database(), { id: "WH-LATE-SALE", event_type: "PAYMENT.SALE.COMPLETED", resource_type: "sale", resource: { billing_agreement_id: "I-LIFECYCLE" } });
  assert.equal(lateSale.action, "stale_sale_ignored");
  for (const [id, eventType, resource] of [
    ["WH-LATE-UPDATE", "BILLING.SUBSCRIPTION.UPDATED", { id: "I-LIFECYCLE", status: "APPROVAL_PENDING", plan_id: TEST_CONFIG.PAYPAL_GROWTH_PLAN_ID }],
    ["WH-LATE-SUSPEND", "BILLING.SUBSCRIPTION.SUSPENDED", { id: "I-LIFECYCLE" }],
    ["WH-LATE-FAIL", "BILLING.SUBSCRIPTION.PAYMENT.FAILED", { id: "I-LIFECYCLE" }],
    ["WH-LATE-REFUND", "PAYMENT.SALE.REFUNDED", { billing_agreement_id: "I-LIFECYCLE" }],
  ] as const) {
    await processVerifiedWebhookEvent(database(), { id, event_type: eventType, resource_type: "subscription", resource });
  }
  assert.equal((sqlite.prepare("SELECT status FROM subscriptions WHERE provider_subscription_id='I-LIFECYCLE'").get() as any).status, "cancelled");
  sqlite.close();
});

test("Starter checkout remains available with an active monthly subscription", async () => {
  const sqlite = createFixture(false, false);
  seedPaidSubscription(sqlite, "I-ESSENTIAL", "essential", "active");
  seedScan(sqlite, "scan-starter", "org-target-test-a", userA.userId, "completed");
  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();
  state.user = userA;
  setPayPalTransport(async (url) => {
    const path = String(url);
    if (path.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "mock-token", expires_in: 3600 });
    if (path.endsWith("/v2/checkout/orders")) return Response.json({ id: "ORDER-STARTER-ALONGSIDE", status: "CREATED", links: [{ rel: "approve", href: "https://sandbox.paypal.com/starter" }] }, { status: 201 });
    throw new Error(`Unexpected PayPal request: ${path}`);
  });
  const response = await createOrderRoute(new Request("https://recomvia.test/api/payments/paypal/create-order", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scanId: "scan-starter" }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).approveUrl, "https://sandbox.paypal.com/starter");
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE status='active'").get() as any).n, 1);
  sqlite.close();
});

test("Security: PayPal secrets are never returned to client and payment flow never calls OpenRouter", async () => {
  const sqlite = createFixture(false, false);
  seedScan(sqlite, "scan-a", "org-target-test-a", userA.userId, "completed");

  Object.assign(state.env, TEST_CONFIG);
  clearPayPalTokenCache();

  setPayPalTransport(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "super-secret-token-12345", expires_in: 3600 }), { status: 200 });
    }
    if (urlStr.includes("/v2/checkout/orders")) {
      return new Response(
        JSON.stringify({
          id: "ORD-SEC-1",
          status: "CREATED",
          links: [{ href: "https://sandbox.paypal.com/checkout?token=ORD-SEC-1", rel: "approve" }],
        }),
        { status: 201 },
      );
    }
    return new Response("Not found", { status: 404 });
  });

  state.user = userA;
  const res = await createOrderRoute(
    new Request("https://recomvia.test/api/payments/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: "scan-a" }),
    }),
  );

  const text = await res.text();
  assert.equal(text.includes(TEST_CONFIG.PAYPAL_CLIENT_SECRET), false);
  assert.equal(text.includes("super-secret-token-12345"), false);

  // Check OpenRouter cost ledger: no AI calls should exist
  const aiCost = sqlite.prepare("SELECT COUNT(*) n FROM cost_ledger WHERE provider = 'openrouter'").get() as any;
  assert.equal(aiCost?.n || 0, 0);

  sqlite.close();
});
