import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(resolve(path), "utf8");
let locale = "en";
const wrap = ({ children }) => React.createElement(React.Fragment, null, children);
const Link = ({ href, children }) => React.createElement("a", { href }, children);
const Button = ({ asChild, children, disabled }) => asChild ? children : React.createElement("button", { disabled }, children);
const icons = new Proxy({}, { get: () => () => null });
function load(path, mocks = {}) {
  const js = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", js)((id) => mocks[id] ?? require(id), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const plans = load("lib/plans.ts");
const mocks = {
  "lucide-react": icons,
  "@/lib/plans": plans,
  "@/app/components/navigation-link": { NavigationLink: Link },
  "@/app/components/public-shell": { PublicShell: ({ children }) => children(locale) },
  "@/components/ui/button": { Button },
  "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogClose", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle", "DialogTrigger"].map((key) => [key, wrap])),
  "@/components/ui/tabs": Object.fromEntries(["Tabs", "TabsContent", "TabsList", "TabsTrigger"].map((key) => [key, wrap])),
};
const { PricingContent } = load("app/pricing/pricing-content.tsx", mocks);
const { PlansPreviewDialog } = load("app/components/plans-preview-dialog.tsx", mocks);
for (const lang of ["en", "ar"]) {
  for (const enabled of [false, true]) {
    test(`${lang}: marketing plans with payments ${enabled ? "enabled" : "disabled"}`, () => {
      locale = lang;
      for (const component of [PricingContent, PlansPreviewDialog]) {
        const html = renderToStaticMarkup(React.createElement(component, { paymentsEnabled: enabled, locale: lang }));
        if (!enabled) {
          assert.equal((html.match(/<button disabled=""/g) || []).length, 4);
          assert.match(html, /href="\/"/);
          assert.doesNotMatch(html, /href="\/subscriptions\?/);
          assert.ok(html.includes(lang === "ar" ? "الدفع الإلكتروني غير متاح مؤقتًا." : "Online payments are temporarily unavailable."));
        } else {
          assert.doesNotMatch(html, /<button disabled=""/);
          for (const plan of ["essential", "growth", "pro"]) assert.ok(html.includes(`/subscriptions?plan=${plan}`));
          assert.match(html, /href="\/"/);
          assert.doesNotMatch(html, /Online payments are temporarily unavailable\.|الدفع الإلكتروني غير متاح مؤقتًا\./);
        }
      }
    });
  }
}
test("workspace navigation and public report labels are accurate", () => {
  const shell = source("app/components/app-shell.tsx");
  assert.doesNotMatch(shell, /Private beta|engine activation|نسخة تجريبية خاصة/);
  assert.match(shell, /href: "\/subscriptions",\s*label: "Subscriptions & billing"/);
  for (const path of ["app/components/public-shell.tsx", "app/scan-experience.tsx"]) {
    const text = source(path);
    assert.doesNotMatch(text, /Sample report|نموذج التقرير/);
    assert.match(text, /signedIn && <Link href="\/report"/);
    assert.match(text, /My reports/);
    assert.match(text, /\/dashboard/);
    assert.match(text, /\/auth\/start/);
  }
});

test("Fix Center shows report-owned evidence, not fabricated brands or credit prices", () => {
  const page = source("app/fix-center/page.tsx");
  const ui = source("app/fix-center/fix-center-experience.tsx");
  assert.match(page, /getLatestWebsiteReportForUser/);
  assert.match(page, /canViewFullReport/);
  assert.match(page, /finding.status !== "pass"/);
  assert.match(ui, /selected.evidence/);
  assert.match(ui, /applicationEnabled: false/);
  assert.doesNotMatch(ui, /Acme|provisional credits|Illustrative confidence|const issues:/);
  const report = source("app/report/report-content.tsx");
  assert.match(report, /canUseFixCredits && fullScan\?\.readinessScore/);
  assert.match(report, /\/fix-center\?scan=/);
});

test("Fix Center exposes immutable proposal history only through scoped data", () => {
  const page = source("app/fix-center/page.tsx");
  const staff = source("app/support/fix-reviews/page.tsx");
  const history = source("app/components/fix-proposal-history.tsx");
  assert.match(page, /listFixProposalHistoryForScan\(user.userId, scan.id\)/);
  assert.match(staff, /listFixProposalHistoryForStaff\(user.userId\)/);
  assert.match(history, /Rollback plan/);
  assert.match(history, /Accepted for planning only/);
  assert.doesNotMatch(history, /fetch\(|creditsCharged/);
});


test("private report and print selectors are bounded before database lookups", async () => {
  const calls = [];
  const report = {
    scan: { engineRuns: [], language: "en" },
    entitlement: { canViewStarterReport: true, reportLevel: "full", planId: "growth" },
  };
  const routeMocks = {
    "@/app/auth": { requireAuthenticatedUser: async () => ({ userId: "account-1", displayName: "Tester" }) },
    "@/db/product": {
      getReportForUser: async (userId, scanId) => {
        calls.push(["scan", userId, scanId]);
        return report;
      },
      getLatestReportForUser: async (userId) => {
        calls.push(["latest", userId]);
        return report;
      },
    },
    "next/navigation": { notFound: () => { throw new Error("not_found"); } },
    "./report-content": { ReportContent: () => null },
    "../printable-report": { PrintableReport: () => null },
    "./print-controls": { PrintControls: () => null },
    "./print.css": {},
  };
  const { default: ReportPage } = load("app/report/page.tsx", routeMocks);
  const { default: PrintReportPage } = load("app/report/print/page.tsx", routeMocks);

  for (const scan of ["", "../other-account", "bad?query", "a".repeat(101), ["scan-1", "scan-2"], 123]) {
    await assert.rejects(
      () => ReportPage({ searchParams: Promise.resolve({ scan }) }),
      /not_found/,
    );
    await assert.rejects(
      () => PrintReportPage({ searchParams: Promise.resolve({ scan }) }),
      /not_found/,
    );
    assert.deepEqual(calls, [], "invalid selectors must not reach private report queries");
  }

  await assert.rejects(
    () => PrintReportPage({ searchParams: Promise.resolve({}) }),
    /not_found/,
  );
  await ReportPage({ searchParams: Promise.resolve({}) });
  assert.deepEqual(calls, [["latest", "account-1"]], "missing selector preserves latest-report UX");
  calls.length = 0;

  await ReportPage({ searchParams: Promise.resolve({ scan: "scan-1" }) });
  await PrintReportPage({ searchParams: Promise.resolve({ scan: "scan-1" }) });
  assert.deepEqual(calls, [
    ["scan", "account-1", "scan-1"],
    ["scan", "account-1", "scan-1"],
  ], "valid selectors still request only the authenticated user's report");
});

test("Fix Center rejects malformed and repeated report IDs without private report reads", async () => {
  const calls = [];
  const routeMocks = {
    "@/app/auth": { requireAuthenticatedUser: async () => ({ userId: "account-1" }) },
    "@/db/product": {
      getEntitlementForUser: async () => ({ canUseFixCredits: true }),
      getLatestWebsiteReportForUser: async (userId) => {
        calls.push(["latest", userId]);
        return null;
      },
      getReportForUser: async (userId, scanId) => {
        calls.push(["scan", userId, scanId]);
        return null;
      },
    },
    "@/db/fix-review": {
      listFixReviewRequests: async () => [],
      listFixProposalHistoryForScan: async () => [],
    },
    "./fix-access-gate": { FixAccessGate: () => null },
    "./fix-center-experience": { FixCenterExperience: () => null },
  };
  const { default: FixCenterPage } = load("app/fix-center/page.tsx", routeMocks);

  for (const scan of ["", "../another-account", "bad?query", "a".repeat(101),
    ["scan-1", "scan-2"], ["scan-1"], 123, null]) {
    await FixCenterPage({ searchParams: Promise.resolve({ scan }) });
    assert.deepEqual(calls, [], "invalid report IDs must never reach the private report query");
  }

  await FixCenterPage({ searchParams: Promise.resolve({}) });
  assert.deepEqual(calls, [["latest", "account-1"]],
    "only an absent selector can request the latest website report");
  calls.length = 0;
  await FixCenterPage({ searchParams: Promise.resolve({ scan: "scan-1" }) });
  assert.deepEqual(calls, [["scan", "account-1", "scan-1"]],
    "a valid selector must remain scoped to the authenticated account");
});


test("staff inbox never renders legacy non-local support source links", () => {
  const inboxMocks = {
    ...mocks,
    "@/components/ui/badge": { Badge: wrap },
    "@/components/ui/table": Object.fromEntries(["Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"].map((key) => [key, wrap])),
    "@/components/ui/dialog": { ...mocks["@/components/ui/dialog"], DialogFooter: wrap },
    "@/components/ui/textarea": { Textarea: () => null },
  };
  const { SupportInbox } = load("app/support/inbox/support-inbox.tsx", inboxMocks);
  const render = (pageUrl) => renderToStaticMarkup(React.createElement(SupportInbox, {
    initialTickets: [{ id: "ticket", publicId: "RCV-TEST", requesterName: "Test",
      requesterEmail: "test@example.org", question: "Help with this report", status: "open",
      createdAt: "2026-11-25T00:00:00Z", pageUrl }],
  }));
  for (const value of ["//evil.example/path", "/\\evil.example/path", "https://evil.example/path", "/\t/evil.example/path", "javascript:alert(1)"]) {
    assert.doesNotMatch(render(value), /Source page/, value);
  }
  assert.match(render("/ar/contact?from=help"), /href="\/ar\/contact\?from=help"/);
});


function assistantHarness() {
  const writes = [];
  const pending = [];
  const stored = [];
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let ask;
  const fakeReact = {
    ...React,
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; writes.push(value); }];
    },
    useRef: (initial) => refs[refIndex++] ??= { current: initial },
    useEffect: () => {},
    useCallback: (callback) => { ask = callback; return callback; },
  };
  const js = ts.transpileModule(source("app/components/knowledge-assistant.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => {
    assert.ok(["/api/assistant", "/api/support/tickets", "/api/support/tickets/status"].includes(url));
    const body = JSON.parse(options.body);
    return new Promise((resolve) => pending.push({
      url, body, question: body.question,
      finish: (payload, status = 200) => resolve(Response.json(payload, { status })),
    }));
  };
  new Function("require", "module", "exports", "fetch", "window", js)((id) => {
    if (id === "react") return fakeReact;
    if (id === "@/lib/site-locale") return {};
    if (id === "@/components/ui/input") return { Input: wrap };
    if (id === "@/components/ui/textarea") return { Textarea: wrap };
    if (id === "@/components/ui/sheet") return Object.fromEntries(
      ["Sheet", "SheetContent", "SheetDescription", "SheetHeader", "SheetTitle", "SheetTrigger"].map((key) => [key, wrap]),
    );
    return mocks[id] ?? require(id);
  }, loadedModule, loadedModule.exports, fakeFetch, {
    location: { pathname: "/ar/contact", search: "" },
    localStorage: { setItem: (key, value) => stored.push([key, JSON.parse(value)]) },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.KnowledgeAssistant();
  };
  render();
  return { ask, writes, pending, stored, render };
}

test("assistant ignores an older unsupported answer after a newer supported Arabic answer", async () => {
  const { ask, writes, pending } = assistantHarness();
  const older = ask("An older question");
  const newer = ask("ما الفرق بين الباقات؟");
  assert.deepEqual(pending.map((entry) => entry.question), ["An older question", "ما الفرق بين الباقات؟"]);
  const recent = { answered: true, answer: "إجابة موثقة", confidence: 1, language: "ar" };
  pending[1].finish(recent);
  assert.deepEqual(await newer, recent);
  assert.ok(writes.includes(false));
  assert.ok(writes.some((value) => value?.answer === recent.answer));
  const count = writes.length;
  const stale = { answered: false, confidence: 0, language: "en" };
  pending[0].finish(stale);
  assert.deepEqual(await older, stale, "each tool caller still receives its own answer");
  assert.equal(writes.length, count, "an older response must not reopen escalation or replace the result");
});

test("assistant ignores stale failure while latest question is still pending", async () => {
  const { ask, writes, pending } = assistantHarness();
  const older = ask("Old question");
  const newer = ask("New question");
  const count = writes.length;
  pending[0].finish({ error: "old failure" }, 500);
  assert.equal(await older, null);
  assert.equal(writes.length, count, "stale errors must not clear the latest loading state");
  pending[1].finish({ error: "new failure" }, 500);
  assert.equal(await newer, null);
  assert.deepEqual(writes.slice(count), ["new failure", false]);
});

test("assistant rejects oversized tool questions before fetch or UI changes", async () => {
  const { ask, writes, pending } = assistantHarness();
  assert.equal(await ask("س".repeat(601)), null);
  assert.equal(pending.length, 0);
  assert.equal(writes.length, 0);
});


function contactHarness() {
  const writes = [];
  const pending = [];
  const stored = [];
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  const fakeReact = {
    ...React,
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => { state[index] = value; writes.push(value); }];
    },
    useRef: (initial) => {
      const index = refIndex++;
      return refs[index] ??= { current: initial };
    },
    useEffect: () => {},
  };
  const js = ts.transpileModule(source("app/contact/contact-form.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => {
    assert.equal(url, "/api/support/tickets");
    assert.equal(options.method, "POST");
    return new Promise((resolve) => pending.push({
      finish: (payload, status = 201) => resolve(Response.json(payload, { status })),
    }));
  };
  new Function("require", "module", "exports", "fetch", "window", js)((id) => {
    if (id === "react") return fakeReact;
    if (id === "@/components/ui/input") return { Input: wrap };
    if (id === "@/components/ui/textarea") return { Textarea: wrap };
    if (id === "@/components/ui/select") return Object.fromEntries(
      ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((key) => [key, wrap]),
    );
    return mocks[id] ?? require(id);
  }, loadedModule, loadedModule.exports, fakeFetch, {
    localStorage: { setItem: (key, value) => stored.push([key, JSON.parse(value)]) },
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.ContactForm({ locale: "ar" });
  };
  return { render, pending, stored, writes };
}

test("contact form submits only once even before rerender and after success", async () => {
  const { render, pending, stored } = contactHarness();
  const submit = render().props.onSubmit;
  const event = { preventDefault() {} };
  const first = submit(event);
  await submit(event);
  assert.equal(pending.length, 1);
  pending[0].finish({ reference: "RCV-TEST", accessKey: "private-key", status: "open" });
  await first;
  await submit(event);
  assert.equal(pending.length, 1, "a completed ticket remains locked until send another");
  assert.equal(stored.length, 1);
  const success = render();
  const again = React.Children.toArray(success.props.children).find((child) => child.props?.onClick);
  assert.ok(again);
  again.props.onClick();
  const second = render().props.onSubmit(event);
  assert.equal(pending.length, 2);
  pending[1].finish({ reference: "RCV-SECOND", accessKey: "second-key" });
  await second;
  assert.equal(stored.length, 2);
});

test("contact form unlocks after a rejected submission for deliberate retry", async () => {
  const { render, pending, stored, writes } = contactHarness();
  const event = { preventDefault() {} };
  const submit = render().props.onSubmit;
  const first = submit(event);
  await submit(event);
  assert.equal(pending.length, 1);
  pending[0].finish({ error: "unavailable" }, 503);
  await first;
  assert.equal(stored.length, 0);
  assert.ok(writes.includes("تعذر إرسال رسالتك."));
  const retry = render().props.onSubmit(event);
  assert.equal(pending.length, 2);
  pending[1].finish({ reference: "RCV-RETRY", accessKey: "retry-key" });
  await retry;
  assert.equal(stored.length, 1);
});


function findAssistantElement(node, predicate) {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = findAssistantElement(child, predicate);
    if (found) return found;
  }
}

async function createAssistantTicket(harness, reference) {
  const question = harness.ask("أحتاج مساعدة بشأن التقرير");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await question;
  const form = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(form);
  const sending = form.props.onSubmit({ preventDefault() {} });
  assert.equal(harness.pending.at(-1).url, "/api/support/tickets");
  harness.pending.at(-1).finish({ reference, accessKey: reference + "-key", status: "open" }, 201);
  await sending;
}

function startAssistantTicketCheck(harness, reference) {
  const button = findAssistantElement(harness.render(), (node) =>
    node.props.variant === "outline" && typeof node.props.onClick === "function");
  assert.ok(button);
  button.props.onClick();
  const request = harness.pending.at(-1);
  assert.equal(request.url, "/api/support/tickets/status");
  assert.deepEqual(request.body, { reference, accessKey: reference + "-key" });
  return request;
}

const settleAssistantFetch = () => new Promise((resolve) => setImmediate(resolve));

test("assistant does not restore an old ticket after a newer ticket is created", async () => {
  const harness = assistantHarness();
  await createAssistantTicket(harness, "RCV-OLD");
  const old = startAssistantTicketCheck(harness, "RCV-OLD");
  await createAssistantTicket(harness, "RCV-NEW");
  const count = harness.writes.length;
  old.finish({ status: "answered", humanReply: "رد قديم" });
  await settleAssistantFetch();
  assert.equal(harness.writes.length, count);
  assert.equal(harness.stored.length, 2);
  assert.equal(harness.stored.at(-1)[1].reference, "RCV-NEW");
  const current = startAssistantTicketCheck(harness, "RCV-NEW");
  current.finish({ status: "answered", humanReply: "رد جديد" });
  await settleAssistantFetch();
  assert.equal(harness.stored.at(-1)[1].humanReply, "رد جديد");
  assert.equal(harness.stored.at(-1)[1].reference, "RCV-NEW");
});

test("assistant ignores obsolete ticket status errors and preserves the latest loading state", async () => {
  const harness = assistantHarness();
  await createAssistantTicket(harness, "RCV-OLD");
  const old = startAssistantTicketCheck(harness, "RCV-OLD");
  await createAssistantTicket(harness, "RCV-NEW");
  const current = startAssistantTicketCheck(harness, "RCV-NEW");
  const count = harness.writes.length;
  old.finish({ error: "obsolete failure" }, 503);
  await settleAssistantFetch();
  assert.equal(harness.writes.length, count);
  current.finish({ error: "current failure" }, 503);
  await settleAssistantFetch();
  assert.deepEqual(harness.writes.slice(count), ["current failure", false]);
  assert.equal(harness.stored.at(-1)[1].reference, "RCV-NEW");
});


test("assistant escalation sends one ticket even before rerender and after success", async () => {
  const harness = assistantHarness();
  const question = harness.ask("أحتاج مساعدة بشأن التقرير");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await question;
  const form = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(form);
  const event = { preventDefault() {} };
  const first = form.props.onSubmit(event);
  await form.props.onSubmit(event);
  assert.equal(harness.pending.filter((entry) => entry.url === "/api/support/tickets").length, 1);
  harness.pending.at(-1).finish({ reference: "RCV-ONE", accessKey: "one-key", status: "open" }, 201);
  await first;
  await form.props.onSubmit(event);
  assert.equal(harness.pending.filter((entry) => entry.url === "/api/support/tickets").length, 1);
  assert.equal(harness.stored.length, 1);
  await createAssistantTicket(harness, "RCV-NEXT");
  assert.equal(harness.stored.length, 2, "a new question may create a new ticket");
});

test("assistant escalation releases its lock after a rejected request", async () => {
  const harness = assistantHarness();
  const question = harness.ask("أحتاج مساعدة بشأن التقرير");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await question;
  const form = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(form);
  const event = { preventDefault() {} };
  const first = form.props.onSubmit(event);
  harness.pending.at(-1).finish({ error: "temporarily unavailable" }, 503);
  await first;
  assert.equal(harness.stored.length, 0);
  const retry = form.props.onSubmit(event);
  assert.equal(harness.pending.filter((entry) => entry.url === "/api/support/tickets").length, 2);
  harness.pending.at(-1).finish({ reference: "RCV-RETRY", accessKey: "retry-key" }, 201);
  await retry;
  assert.equal(harness.stored.length, 1);
});

test("completed escalation does not dismiss a newer unanswered question", async () => {
  const harness = assistantHarness();
  const question = harness.ask("أحتاج مساعدة بشأن التقرير");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await question;
  const form = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  const first = form.props.onSubmit({ preventDefault() {} });
  const request = harness.pending.at(-1);
  const newer = harness.ask("لدي سؤال آخر حول حسابي");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await newer;
  request.finish({ reference: "RCV-OLD", accessKey: "old-key" }, 201);
  await first;
  assert.ok(findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3")));
  assert.equal(harness.stored.at(-1)[1].reference, "RCV-OLD");
});


function staffReplyHarness() {
  const state = [];
  const refs = [];
  const pending = [];
  let stateIndex = 0;
  let refIndex = 0;
  const fakeReact = {
    ...React,
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value) => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      }];
    },
    useRef: (initial) => refs[refIndex++] ??= { current: initial },
    useMemo: (calculate) => calculate(),
  };
  const js = ts.transpileModule(source("app/support/inbox/support-inbox.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => new Promise((resolve) => pending.push({
    url, body: JSON.parse(options.body),
    finish: (payload, status = 200) => resolve(Response.json(payload, { status })),
  }));
  const inboxMocks = {
    ...mocks,
    react: fakeReact,
    "@/components/ui/badge": { Badge: wrap },
    "@/components/ui/table": Object.fromEntries(["Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"].map((key) => [key, wrap])),
    "@/components/ui/dialog": { ...mocks["@/components/ui/dialog"], DialogFooter: wrap },
    "@/components/ui/textarea": { Textarea: wrap },
  };
  new Function("require", "module", "exports", "fetch", js)((id) =>
    inboxMocks[id] ?? require(id), loadedModule, loadedModule.exports, fakeFetch);
  const initialTickets = ["one", "two"].map((id) => ({
    id, publicId: "RCV-" + id, requesterName: "Test", requesterEmail: "test@example.org",
    question: "Question " + id, status: "open", pageUrl: "/contact",
    createdAt: "2026-11-25T00:00:00Z",
  }));
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.SupportInbox({ initialTickets });
  };
  const element = (predicate) => {
    const found = findAssistantElement(render(), predicate);
    assert.ok(found);
    return found.props;
  };
  // Ticket buttons appear in the same order as the two open tickets.
  const ticketButton = (index) => {
    const buttons = [];
    function walk(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === Button && node.props.className?.includes("rounded-xl font-bold")) buttons.push(node.props);
      React.Children.toArray(node.props.children).forEach(walk);
    }
    walk(render());
    assert.ok(buttons[index]);
    return buttons[index];
  };
  const editor = () => element((node) => node.props.placeholder === "Write a clear, complete human reply…");
  const dialog = () => element((node) => typeof node.props.onOpenChange === "function");
  const publish = () => element((node) => node.type === Button && node.props.className === "rounded-xl bg-blue-600 font-bold");
  const cancel = () => element((node) => node.type === Button && node.props.children === "Cancel");
  return { pending, ticketButton, editor, dialog, publish, cancel };
}

test("staff reply saves only once and keeps the selected draft while the request is pending", async () => {
  const harness = staffReplyHarness();
  harness.ticketButton(0).onClick();
  harness.editor().onChange({ target: { value: "رد واضح للعميل" } });
  const submit = harness.publish().onClick;
  submit();
  submit();
  assert.equal(harness.pending.length, 1);
  assert.deepEqual(harness.pending[0].body, { reply: "رد واضح للعميل" });
  assert.equal(harness.pending[0].url, "/api/support/tickets/one/reply");
  assert.equal(harness.editor().disabled, true);
  harness.cancel().onClick();
  harness.dialog().onOpenChange(false);
  harness.ticketButton(1).onClick();
  harness.editor().onChange({ target: { value: "Unintended edit" } });
  assert.equal(harness.dialog().open, true);
  assert.equal(harness.editor().value, "رد واضح للعميل");
  harness.pending[0].finish({});
  await settleAssistantFetch();
  assert.equal(harness.dialog().open, false);
  submit();
  assert.equal(harness.pending.length, 1, "a stale callback cannot republish a completed reply");
});

test("staff reply preserves the draft on failure and permits a deliberate retry", async () => {
  const harness = staffReplyHarness();
  harness.ticketButton(0).onClick();
  harness.editor().onChange({ target: { value: "  " } });
  harness.publish().onClick();
  assert.equal(harness.pending.length, 0);
  harness.editor().onChange({ target: { value: "A valid human reply" } });
  harness.publish().onClick();
  harness.pending[0].finish({ error: "temporary failure" }, 503);
  await settleAssistantFetch();
  assert.equal(harness.dialog().open, true);
  assert.equal(harness.editor().value, "A valid human reply");
  assert.equal(harness.editor().disabled, false);
  harness.publish().onClick();
  assert.equal(harness.pending.length, 2);
  harness.pending[1].finish({});
  await settleAssistantFetch();
  assert.equal(harness.dialog().open, false);
});
