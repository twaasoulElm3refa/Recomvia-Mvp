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
  "@/lib/site-locale": load("lib/site-locale.ts"),
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
          assert.ok(html.includes(`href="${component === PricingContent && lang === "ar" ? "/ar" : "/"}"`));
          assert.doesNotMatch(html, /href="\/subscriptions\?/);
          assert.ok(html.includes(lang === "ar" ? "الدفع الإلكتروني غير متاح مؤقتًا." : "Online payments are temporarily unavailable."));
        } else {
          assert.doesNotMatch(html, /<button disabled=""/);
          for (const plan of ["essential", "growth", "pro"]) assert.ok(html.includes(`/subscriptions?plan=${plan}`));
          assert.ok(html.includes(`href="${component === PricingContent && lang === "ar" ? "/ar" : "/"}"`));
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


function assistantHarness(savedTicket) {
  const effects = [];
  const timers = [];
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
    useEffect: (effect) => { effects.push(effect); },
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
    localStorage: { getItem: () => savedTicket ?? null, setItem: (key, value) => stored.push([key, JSON.parse(value)]) },
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
  });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    effects.length = 0;
    return loadedModule.exports.KnowledgeAssistant();
  };
  render();
  const restoreTicket = () => {
    effects[1]();
    timers.shift()();
  };
  return { ask, writes, pending, stored, render, restoreTicket };
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
      body: JSON.parse(options.body),
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


test("contact form protects every editable field during a pending ticket and preserves it on failure", async () => {
  const { render, pending, stored } = contactHarness();
  const event = { preventDefault() {} };
  const find = (tree, predicate) => {
    const node = findAssistantElement(tree, predicate);
    assert.ok(node);
    return node.props;
  };
  const fields = (tree) => [
    find(tree, (node) => node.props.placeholder === "اكتب اسمك"),
    find(tree, (node) => node.props.type === "email"),
    find(tree, (node) => typeof node.props.onValueChange === "function"),
    find(tree, (node) => node.props.placeholder === "اكتب ما تحتاج إليه"),
    find(tree, (node) => node.type === "input" && node.props.tabIndex === -1),
  ];
  const edit = (field, value) => field.onValueChange
    ? field.onValueChange(value)
    : field.onChange({ target: { value } });
  const values = ["Test Sender", "test@example.org", "Technical support", "My original support message", ""];
  fields(render()).forEach((field, i) => edit(field, values[i]));
  const before = render();
  const staleFields = fields(before);
  const submission = before.props.onSubmit(event);
  // Even queued callbacks from before the disabled rerender cannot mutate the draft.
  staleFields.forEach((field) => edit(field, "changed"));
  const busy = render();
  assert.equal(busy.props["aria-busy"], true);
  assert.ok(fields(busy).every((field) => field.disabled === true));
  assert.deepEqual(fields(busy).map((field) => field.value), values);
  assert.equal(pending[0].body.question, "[Technical support] My original support message");
  pending[0].finish({ error: "unavailable" }, 503);
  await submission;
  const failed = render();
  assert.equal(failed.props["aria-busy"], false);
  assert.ok(fields(failed).every((field) => field.disabled === false));
  assert.deepEqual(fields(failed).map((field) => field.value), values);
  assert.equal(stored.length, 0);
  edit(fields(failed)[3], "My revised support message");
  const retry = render().props.onSubmit(event);
  assert.equal(pending[1].body.question, "[Technical support] My revised support message");
  pending[1].finish({ reference: "RCV-RETRY", accessKey: "retry-key" });
  await retry;
  assert.equal(stored[0][1].question, "[Technical support] My revised support message");
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

test("assistant rejects stale escalation forms even when the new question has the same text", async () => {
  const harness = assistantHarness();
  const question = "أحتاج مساعدة بشأن التقرير";
  const first = harness.ask(question);
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await first;
  const form = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(form);
  const newer = harness.ask(question);
  const before = harness.pending.length;
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(harness.pending.length, before, "a stale form cannot send during a newer question");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await newer;
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(harness.pending.length, before, "a stale form cannot send for a later result");
  const current = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(current);
  const send = current.props.onSubmit({ preventDefault() {} });
  assert.equal(harness.pending.at(-1).url, "/api/support/tickets");
  harness.pending.at(-1).finish({ reference: "RCV-CURRENT", accessKey: "current-key" }, 201);
  await send;
  assert.equal(harness.stored.at(-1)[1].reference, "RCV-CURRENT");
});

test("obsolete escalation failures do not overwrite a newer question and its support form", async () => {
  const harness = assistantHarness();
  const first = harness.ask("أحتاج مساعدة بشأن التقرير");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await first;
  const form = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(form);
  const send = form.props.onSubmit({ preventDefault() {} });
  const old = harness.pending.at(-1);
  const newer = harness.ask("سؤال آخر حول الحساب");
  harness.pending.at(-1).finish({ answered: false, confidence: 0, language: "ar" });
  await newer;
  const count = harness.writes.length;
  old.finish({ error: "obsolete escalation failure" }, 503);
  await send;
  assert.deepEqual(harness.writes.slice(count), [false]);
  const current = findAssistantElement(harness.render(), (node) =>
    node.type === "form" && node.props.className.includes("space-y-3"));
  assert.ok(current);
  const retry = current.props.onSubmit({ preventDefault() {} });
  assert.equal(harness.pending.at(-1).body.question, "سؤال آخر حول الحساب");
  harness.pending.at(-1).finish({ reference: "RCV-NEW", accessKey: "new-key" }, 201);
  await retry;
  assert.equal(harness.stored.length, 1);
});


function projectRenameHarness() {
  const state = [];
  const refs = [];
  const pending = [];
  let stateIndex = 0;
  let refIndex = 0;
  let refreshes = 0;
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
  };
  const js = ts.transpileModule(source("app/dashboard/project-slot-controls.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => {
    assert.equal(url, "/api/projects/rename");
    assert.equal(options.method, "POST");
    return new Promise((resolve) => pending.push({
      body: JSON.parse(options.body),
      finish: (payload, status = 200) => resolve(Response.json(payload, { status })),
    }));
  };
  const projectMocks = {
    ...mocks, react: fakeReact,
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/components/ui/input": { Input: wrap },
    "@/hooks/use-site-locale": { useSiteLocale: () => "ar" },
  };
  new Function("require", "module", "exports", "fetch", js)((id) =>
    projectMocks[id] ?? require(id), loadedModule, loadedModule.exports, fakeFetch);
  const initialProjects = ["one", "two"].map((id) => ({
    id, displayName: id, withinPlanLimit: true, canRename: true, completedScans: 1,
    createdAt: "2026-11-25T00:00:00Z",
  }));
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.ProjectSlotControls({ initialProjects, projectLimit: 3, canMonitor: true });
  };
  const props = (predicate) => {
    const node = findAssistantElement(render(), predicate);
    assert.ok(node);
    return node.props;
  };
  const rename = (index = 0) => {
    const buttons = [];
    function walk(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === Button && node.props.children === "تعديل الاسم") buttons.push(node.props);
      React.Children.toArray(node.props.children).forEach(walk);
    }
    walk(render());
    assert.ok(buttons[index]);
    return buttons[index];
  };
  return {
    pending, rename, render, refreshes: () => refreshes,
    editor: () => props((node) => node.props.maxLength === 80),
    form: () => props((node) => node.type === "form"),
    cancel: () => props((node) => node.type === Button && node.props.children === "إلغاء"),
  };
}

test("project rename serializes requests and protects the active draft from switching or editing", async () => {
  const h = projectRenameHarness();
  h.rename().onClick();
  h.editor().onChange({ target: { value: "مشروعي الجديد" } });
  const submit = h.form().onSubmit;
  const change = h.editor().onChange;
  const event = { preventDefault() {} };
  const first = submit(event);
  await submit(event);
  assert.equal(h.pending.length, 1);
  assert.deepEqual(h.pending[0].body, { projectId: "one", expectedName: "one", displayName: "مشروعي الجديد" });
  assert.equal(h.editor().disabled, true);
  assert.equal(h.rename().disabled, true);
  h.rename().onClick();
  h.cancel().onClick();
  change({ target: { value: "Unintended change" } });
  assert.equal(h.editor().value, "مشروعي الجديد");
  h.pending[0].finish({ projectId: "one", displayName: "مشروعي الجديد", projectKeyUnchanged: true, quotasReset: false });
  await first;
  assert.equal(h.refreshes(), 1);
  h.rename().onClick();
  assert.equal(h.editor().value, "مشروعي الجديد");
  await submit(event);
  assert.equal(h.pending.length, 1, "old edit callbacks cannot submit after reopening the same project");
});

test("project rename preserves a failed draft and accepts an intentional retry", async () => {
  const h = projectRenameHarness();
  h.rename().onClick();
  h.editor().onChange({ target: { value: "اسم صالح" } });
  const event = { preventDefault() {} };
  const first = h.form().onSubmit(event);
  h.pending[0].finish({ code: "conflict" }, 409);
  await first;
  assert.equal(h.editor().disabled, false);
  assert.equal(h.editor().value, "اسم صالح");
  assert.equal(h.refreshes(), 0);
  const second = h.form().onSubmit(event);
  assert.equal(h.pending.length, 2);
  h.pending[1].finish({ projectId: "one", displayName: "اسم صالح", projectKeyUnchanged: true, quotasReset: false });
  await second;
  assert.equal(h.refreshes(), 1);
});


function monitoringControlHarness(canMonitor = true) {
  const state = [];
  const refs = [];
  const pending = [];
  let stateIndex = 0;
  let refIndex = 0;
  let refreshes = 0;
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
  };
  const js = ts.transpileModule(source("app/dashboard/monitoring-controls.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => {
    assert.equal(url, "/api/monitoring/control");
    assert.equal(options.method, "POST");
    return new Promise((resolve) => pending.push({
      body: JSON.parse(options.body),
      finish: (payload, status = 200) => resolve(Response.json(payload, { status })),
    }));
  };
  const controlMocks = {
    ...mocks, react: fakeReact,
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/hooks/use-site-locale": { useSiteLocale: () => "ar" },
  };
  new Function("require", "module", "exports", "fetch", js)((id) =>
    controlMocks[id] ?? require(id), loadedModule, loadedModule.exports, fakeFetch);
  const initialSchedules = ["one", "two"].map((id, index) => ({
    id, targetName: id, state: index === 0 ? "active" : "paused",
    nextRunAt: "2026-11-27 00:00:00", lastStatus: null, lastScanId: null, leaseUntil: null,
  }));
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.MonitoringControls({ initialSchedules, canMonitor });
  };
  const button = (index) => {
    const buttons = [];
    function walk(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === Button) buttons.push(node.props);
      React.Children.toArray(node.props.children).forEach(walk);
    }
    walk(render());
    assert.ok(buttons[index]);
    return buttons[index];
  };
  return { pending, button, render, refreshes: () => refreshes };
}

test("monitoring controls serialize actions and discard callbacks for a changed schedule", async () => {
  const h = monitoringControlHarness();
  const pause = h.button(0).onClick;
  const resumeOther = h.button(1).onClick;
  pause();
  pause();
  resumeOther();
  assert.equal(h.pending.length, 1);
  assert.deepEqual(h.pending[0].body, { scheduleId: "one", action: "pause" });
  assert.equal(h.button(0).disabled, true);
  assert.equal(h.button(1).disabled, true);
  h.pending[0].finish({ state: "paused", nextRunAt: "2026-11-27 00:00:00", scanStarted: false });
  await settleAssistantFetch();
  assert.equal(h.refreshes(), 1);
  assert.equal(h.button(0).children, "استئناف المتابعة");
  pause();
  assert.equal(h.pending.length, 1, "obsolete pause callback cannot send again");
  h.button(0).onClick();
  assert.deepEqual(h.pending[1].body, { scheduleId: "one", action: "resume" });
  h.pending[1].finish({ state: "active", nextRunAt: "2026-11-28 00:00:00", scanStarted: false });
  await settleAssistantFetch();
  pause();
  assert.equal(h.pending.length, 2, "even a matching state does not revive an old callback");
  assert.equal(h.refreshes(), 2);
});

test("monitoring controls reject inconsistent success payloads and allow deliberate retry", async () => {
  const h = monitoringControlHarness();
  for (const payload of [
    { state: "active", nextRunAt: "2026-11-27 00:00:00", scanStarted: false },
    { state: "paused", nextRunAt: 123, scanStarted: false },
    { state: "paused", nextRunAt: "2026-11-27 00:00:00", scanStarted: true },
  ]) {
    h.button(0).onClick();
    h.pending.at(-1).finish(payload);
    await settleAssistantFetch();
    assert.equal(h.refreshes(), 0);
    assert.equal(h.button(0).disabled, false);
    assert.equal(h.button(0).children, "إيقاف المتابعة");
    assert.ok(findAssistantElement(h.render(), (node) => node.props.role === "alert"));
  }
  h.button(0).onClick();
  h.pending.at(-1).finish({ state: "paused", nextRunAt: "2026-11-27 00:00:00", scanStarted: false });
  await settleAssistantFetch();
  assert.equal(h.refreshes(), 1);
  assert.equal(h.button(0).children, "استئناف المتابعة");
  assert.equal(findAssistantElement(h.render(), (node) => node.props.role === "alert"), undefined);
});

test("monitoring controls never request a resume without the plan entitlement", () => {
  const h = monitoringControlHarness(false);
  assert.equal(h.button(1).disabled, true);
  h.button(1).onClick();
  assert.equal(h.pending.length, 0);
});


function proposalDecisionHarness(requestedFindingIds = ["one", "two"]) {
  const state = [];
  const refs = [];
  const pending = [];
  let stateIndex = 0;
  let refIndex = 0;
  const fakeReact = {
    ...React,
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      }];
    },
    useRef: (initial) => refs[refIndex++] ??= { current: initial },
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useEffect: () => {},
  };
  const js = ts.transpileModule(source("app/fix-center/fix-center-experience.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => {
    assert.ok(["/api/fix-proposals/decision", "/api/fix-reviews"].includes(url));
    assert.equal(options.method, "POST");
    return new Promise((resolve) => pending.push({
      url, body: JSON.parse(options.body),
      finish: (payload, status = 200) => resolve(Response.json(payload, { status })),
    }));
  };
  const localMocks = {
    ...mocks, react: fakeReact,
    "@/app/components/app-shell": { AppShell: wrap, StatusPill: wrap },
    "@/components/ui/card": { Card: wrap, CardContent: wrap },
    "@/components/ui/dialog": { ...mocks["@/components/ui/dialog"], DialogFooter: wrap },
    "@/hooks/use-site-locale": { useSiteLocale: () => "ar" },
    "@/lib/analysis-target": { safeSourceUrl: () => null },
    "@/app/components/fix-proposal-history": { FixProposalHistory: () => null },
  };
  new Function("require", "module", "exports", "fetch", js)((id) =>
    localMocks[id] ?? require(id), loadedModule, loadedModule.exports, fakeFetch);
  const findings = ["one", "two"].map((id) => ({
    id, title: id, code: id, category: "content", severity: "high", status: "fail",
    explanation: "Finding", evidence: "Evidence", sourceUrl: null,
  }));
  const reviewProposals = findings.map(({ id }) => ({
    findingId: id, proposalId: "proposal-" + id, proposalVersion: 1, decision: null,
    decisionComment: null, scope: "Scope", proposedText: "Text", rationale: "Reason", rollbackPlan: "Rollback",
  }));
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.FixCenterExperience({
      scanId: "scan-1", targetName: "Example", hasWebsiteAudit: true, findings,
      requestedFindingIds, reviewProposals, proposalHistory: [],
    });
  };
  const props = (predicate) => {
    const node = findAssistantElement(render(), predicate);
    assert.ok(node);
    return node.props;
  };
  const open = (index) => {
    const buttons = [];
    function walk(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === Button && React.Children.toArray(node.props.children).includes("راجع الدليل")) buttons.push(node.props);
      React.Children.toArray(node.props.children).forEach(walk);
    }
    walk(render());
    assert.ok(buttons[index]);
    return buttons[index];
  };
  return {
    pending, render, open,
    dialog: () => props((node) => typeof node.props.onOpenChange === "function"),
    comment: () => props((node) => node.type === "textarea"),
    changes: () => props((node) => node.type === Button && node.props.children === "اطلب تعديل المسودة"),
    accept: () => props((node) => node.type === Button && node.props.children === "أقبل المسودة لأغراض التخطيط فقط"),
    review: () => props((node) => node.type === Button && ["اطلب مراجعة بشرية", "جارٍ إرسال الطلب…", "طُلِبت المراجعة"].includes(node.props.children)),
    alert: () => findAssistantElement(render(), (node) => node.props.role === "alert")?.props.children,
  };
}

test("planning decision comments never carry across findings or reopened dialogs", () => {
  const h = proposalDecisionHarness();
  h.open(0).onClick();
  h.comment().onChange({ target: { value: "تعليق خاص بالمقترح الأول" } });
  const obsolete = h.changes().onClick;
  const oldEdit = h.comment().onChange;
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  assert.equal(h.comment().value, "");
  obsolete();
  oldEdit({ target: { value: "تعليق قديم" } });
  assert.equal(h.comment().value, "");
  assert.equal(h.pending.length, 0);
  h.dialog().onOpenChange(false);
  h.open(0).onClick();
  assert.equal(h.comment().value, "");
  obsolete();
  assert.equal(h.pending.length, 0, "reopening the same finding does not revive old callbacks");
});

test("planning decisions block duplicates and conflicting actions, preserve failed drafts and allow retry", async () => {
  const h = proposalDecisionHarness();
  h.open(0).onClick();
  const note = "يرجى مراجعة المقترح قبل اعتماده";
  h.comment().onChange({ target: { value: note } });
  const submit = h.changes().onClick;
  const accept = h.accept().onClick;
  const edit = h.comment().onChange;
  submit();
  submit();
  accept();
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  edit({ target: { value: "unintended edit" } });
  assert.equal(h.pending.length, 1);
  assert.deepEqual(h.pending[0].body, {
    scanId: "scan-1", proposalId: "proposal-one", decision: "changes_requested", comment: note,
  });
  assert.equal(h.comment().disabled, true);
  assert.equal(h.comment().value, note);
  h.pending[0].finish({ code: "conflict" }, 409);
  await settleAssistantFetch();
  assert.equal(h.comment().disabled, false);
  assert.equal(h.comment().value, note);
  h.changes().onClick();
  assert.equal(h.pending.length, 2);
  h.pending[1].finish({ decision: { proposalId: "proposal-one", decision: "changes_requested" }, applied: false, creditsCharged: 0 });
  await settleAssistantFetch();
  submit();
  accept();
  assert.equal(h.pending.length, 2, "a confirmed decision cannot be sent again by a stale callback");
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  assert.equal(h.comment().value, "");
  assert.equal(h.changes().disabled, true);
});


test("human review requests serialize submissions and reject callbacks from closed evidence dialogs", async () => {
  const h = proposalDecisionHarness([]);
  h.open(0).onClick();
  const stale = h.review().onClick;
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  stale();
  assert.equal(h.pending.length, 0);
  h.dialog().onOpenChange(false);
  h.open(0).onClick();
  stale();
  assert.equal(h.pending.length, 0, "reopening the same finding must not revive the old request");
  const submit = h.review().onClick;
  submit();
  submit();
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  h.accept().onClick();
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].url, "/api/fix-reviews");
  assert.deepEqual(h.pending[0].body, { scanId: "scan-1", findingId: "one" });
  assert.equal(h.review().disabled, true);
  h.pending[0].finish({ request: { findingId: "one" }, executionEnabled: false, approved: false, creditsCharged: 0 }, 201);
  await settleAssistantFetch();
  submit();
  assert.equal(h.pending.length, 1, "successful requests cannot be submitted again using a stale callback");
  assert.equal(h.review().children, "طُلِبت المراجعة");
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  assert.equal(h.review().disabled, false);
});

test("human review rejects unsafe confirmations, isolates errors and permits an intentional retry", async () => {
  const h = proposalDecisionHarness([]);
  h.open(0).onClick();
  h.review().onClick();
  h.pending[0].finish({ request: { findingId: "one" }, executionEnabled: false, approved: true, creditsCharged: 0 });
  await settleAssistantFetch();
  assert.equal(h.review().disabled, false);
  assert.ok(h.alert());
  h.dialog().onOpenChange(false);
  h.open(1).onClick();
  assert.equal(h.alert(), undefined);
  h.dialog().onOpenChange(false);
  h.open(0).onClick();
  assert.equal(h.alert(), undefined);
  h.review().onClick();
  h.pending[1].finish({ request: { findingId: "one" }, executionEnabled: false, approved: false, creditsCharged: 0 }, 200);
  await settleAssistantFetch();
  assert.equal(h.review().children, "طُلِبت المراجعة");
  assert.equal(h.alert(), undefined);
  assert.equal(h.pending.length, 2);
});


function staffProposalHarness() {
  const state = [];
  const refs = [];
  const pending = [];
  let stateIndex = 0;
  let refIndex = 0;
  let refreshes = 0;
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
  };
  const Input = () => null;
  const Textarea = () => null;
  const js = ts.transpileModule(source("app/support/fix-reviews/proposal-form.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const fakeFetch = (url, options) => new Promise((resolve) => pending.push({
    url, body: JSON.parse(options.body),
    finish: (payload, status = 201) => resolve(Response.json(payload, { status })),
  }));
  const formMocks = {
    ...mocks, react: fakeReact,
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/components/ui/input": { Input },
    "@/components/ui/textarea": { Textarea },
  };
  new Function("require", "module", "exports", "fetch", js)((id) =>
    formMocks[id] ?? require(id), loadedModule, loadedModule.exports, fakeFetch);
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return loadedModule.exports.FixProposalForm({ fixId: "review_one", currentVersion: 2 });
  };
  const fields = () => {
    const found = [];
    function walk(node) {
      if (!React.isValidElement(node)) return;
      if (node.type === Input || node.type === Textarea) found.push(node.props);
      React.Children.toArray(node.props.children).forEach(walk);
    }
    walk(render());
    assert.equal(found.length, 4);
    return found;
  };
  const submit = () => render().props.onSubmit;
  const fill = (values) => values.forEach((value, index) => fields()[index].onChange({ target: { value } }));
  const button = () => findAssistantElement(render(), (node) => node.type === Button).props;
  const confirmation = (version = 3) => ({
    proposal: { fixId: "review_one", version }, applied: false, approved: false, creditsCharged: 0,
  });
  return { pending, fields, submit, fill, button, confirmation, refreshes: () => refreshes };
}

const staffDraftValues = ["نطاق التغيير", "نص مقترح للتعديل", "سبب واضح للتعديل", "خطة تراجع واضحة"];
const staffSubmitEvent = { preventDefault() {} };

test("staff proposal draft saves once, protects edits and permits a deliberate new version", async () => {
  const h = staffProposalHarness();
  h.fill(staffDraftValues);
  const submit = h.submit();
  const oldEdit = h.fields()[0].onChange;
  const first = submit(staffSubmitEvent);
  await submit(staffSubmitEvent);
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].url, "/api/fix-proposals");
  assert.deepEqual(h.pending[0].body, {
    fixId: "review_one", scope: staffDraftValues[0], proposedText: staffDraftValues[1],
    rationale: staffDraftValues[2], rollbackPlan: staffDraftValues[3],
  });
  assert.ok(h.fields().every((field) => field.disabled));
  assert.equal(h.button().disabled, true);
  oldEdit({ target: { value: "Unintended edit" } });
  assert.deepEqual(h.fields().map((field) => field.value), staffDraftValues);
  h.pending[0].finish(h.confirmation());
  await first;
  assert.equal(h.refreshes(), 1);
  assert.deepEqual(h.fields().map((field) => field.value), ["", "", "", ""]);
  oldEdit({ target: { value: "Stale edit" } });
  await submit(staffSubmitEvent);
  assert.equal(h.pending.length, 1);
  assert.equal(h.fields()[0].value, "");
  h.fill(staffDraftValues);
  const next = h.submit()(staffSubmitEvent);
  assert.equal(h.pending.length, 2);
  h.pending[1].finish(h.confirmation(4));
  await next;
  assert.equal(h.refreshes(), 2);
});

test("staff proposal preserves drafts on failure or unsafe confirmation and permits retry", async () => {
  const h = staffProposalHarness();
  h.fill(["    ", ...staffDraftValues.slice(1)]);
  await h.submit()(staffSubmitEvent);
  assert.equal(h.pending.length, 0);
  h.fill(staffDraftValues);
  const invalid = [
    [{ code: "temporarily_unavailable" }, 503],
    [{ ...h.confirmation(), creditsCharged: 1 }, 201],
    [{ ...h.confirmation(), approved: true }, 201],
    [{ ...h.confirmation(), applied: true }, 201],
    [{ ...h.confirmation(), proposal: { fixId: "review_other", version: 3 } }, 201],
    [h.confirmation(2), 201],
  ];
  for (const [payload, status] of invalid) {
    const save = h.submit()(staffSubmitEvent);
    h.pending.at(-1).finish(payload, status);
    await save;
    assert.deepEqual(h.fields().map((field) => field.value), staffDraftValues);
    assert.ok(h.fields().every((field) => !field.disabled));
    assert.equal(h.refreshes(), 0);
  }
  const retry = h.submit()(staffSubmitEvent);
  h.pending.at(-1).finish(h.confirmation());
  await retry;
  assert.equal(h.refreshes(), 1);
  assert.deepEqual(h.fields().map((field) => field.value), ["", "", "", ""]);
});


test("assistant ignores malformed stored tickets without rendering a reply or offering a status lookup", () => {
  const valid = { reference: "RCV-ABC-123ABC", accessKey: "a".repeat(36), question: "A support question", status: "answered", humanReply: "A reply" };
  for (const saved of [
    "{bad json", "null", "[]", "42", JSON.stringify({}),
    JSON.stringify({ ...valid, reference: {} }),
    JSON.stringify({ ...valid, accessKey: "bad-key" }),
    JSON.stringify({ ...valid, status: "unknown" }),
    JSON.stringify({ ...valid, humanReply: { unsafe: true } }),
    JSON.stringify({ ...valid, updatedAt: 42 }),
  ]) {
    const h = assistantHarness(saved);
    h.restoreTicket();
    assert.equal(findAssistantElement(h.render(), (node) =>
      node.props.variant === "outline" && typeof node.props.onClick === "function"), undefined);
    assert.equal(h.pending.length, 0);
    assert.equal(h.stored.length, 0, "do not overwrite browser storage");
  }
});

test("assistant restores a valid saved private ticket and checks only its saved credentials", () => {
  const ticket = { reference: "RCV-ABC-123ABC", accessKey: "a".repeat(36), question: "A support question", status: "answered", humanReply: "رد موثوق" };
  const h = assistantHarness(JSON.stringify(ticket));
  h.restoreTicket();
  const tree = h.render();
  assert.ok(findAssistantElement(tree, (node) => node.props.children === ticket.humanReply));
  const button = findAssistantElement(tree, (node) =>
    node.props.variant === "outline" && typeof node.props.onClick === "function");
  assert.ok(button);
  button.props.onClick();
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].url, "/api/support/tickets/status");
  assert.deepEqual(h.pending[0].body, { reference: ticket.reference, accessKey: ticket.accessKey });
});


test("assistant exposes accessible names and busy state throughout bilingual support escalation", async () => {
  for (const [language, question, labels] of [
    ["en", "Please help with my report", ["Name", "Email address", "Support question"]],
    ["ar", "أحتاج مساعدة بشأن التقرير", ["الاسم", "البريد الإلكتروني", "سؤال الدعم"]],
  ]) {
    const h = assistantHarness();
    const find = (predicate) => findAssistantElement(h.render(), predicate);
    const field = (label) => find((node) => node.props["aria-label"] === label);
    const mainForm = () => find((node) => node.type === "form" && node.props.className.includes("border-t"));
    assert.equal(field("Ask a question").props.dir, "auto");
    assert.equal(mainForm().props["aria-busy"], false);
    const asking = h.ask(question);
    assert.equal(mainForm().props["aria-busy"], true);
    assert.ok(find((node) => node.props.role === "status"));
    h.pending.at(-1).finish({ answered: false, confidence: 0, language });
    await asking;
    assert.equal(mainForm().props["aria-busy"], false);
    assert.equal(field(labels[0]).props.autoComplete, "name");
    assert.equal(field(labels[1]).props.autoComplete, "email");
    assert.equal(field(labels[1]).props.dir, "ltr");
    assert.equal(field(labels[2]).props.dir, "auto");
    assert.equal(field(labels[2]).props.value, question);
    const escalation = () => find((node) => node.type === "form" && node.props.className.includes("space-y-3"));
    assert.equal(escalation().props["aria-busy"], false);
    const sending = escalation().props.onSubmit({ preventDefault() {} });
    assert.equal(escalation().props["aria-busy"], true);
    h.pending.at(-1).finish({ error: "Try again" }, 503);
    await sending;
    assert.equal(escalation().props["aria-busy"], false);
    assert.equal(field(labels[2]).props.value, question);
    assert.ok(find((node) => node.props.role === "alert"));
  }
});
