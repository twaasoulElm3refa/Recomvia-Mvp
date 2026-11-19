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
