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
} from "../lib/paypal";
import { getReportForUser } from "../db/product";
import { POST as createOrderRoute } from "../app/api/payments/paypal/create-order/route";
import { POST as captureOrderRoute } from "../app/api/payments/paypal/capture-order/route";
import { POST as createSubscriptionRoute } from "../app/api/payments/paypal/create-subscription/route";
import { POST as syncSubscriptionRoute } from "../app/api/payments/paypal/sync-subscription/route";
import { POST as webhookRoute } from "../app/api/payments/paypal/webhook/route";

const TEST_CONFIG = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "test-client-id",
  PAYPAL_CLIENT_SECRET: "test-client-secret",
  PAYPAL_WEBHOOK_ID: "test-webhook-id",
  PAYPAL_ESSENTIAL_PLAN_ID: "P-ESSENTIAL-123",
  PAYPAL_GROWTH_PLAN_ID: "P-GROWTH-456",
  PAYPAL_PRO_PLAN_ID: "P-PRO-789",
};

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

test("Sandbox-only guard strictly rejects live mode and accepts sandbox", () => {
  assert.equal(getPayPalBaseUrl("sandbox"), "https://api-m.sandbox.paypal.com");
  assert.throws(() => getPayPalBaseUrl("live"), /Only PayPal Sandbox is permitted/);
  assert.throws(() => getPayPalBaseUrl("production"), /Only PayPal Sandbox is permitted/);
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
