# Recomvia

For the implemented plan analysis and deployment/acceptance steps, read `ANALYSIS_HANDOFF_AR.md`; approved pricing is in `PRICING_HANDOFF_AR.md`. The paid catalog is published for enquiries; checkout is not live.

Recomvia is an AI Visibility Optimization Platform built around the product loop:

`Measure → Explain → Fix → Monitor → Improve`

The current repository is a functional private-beta foundation. A visitor submits a public website URL, a person or brand name, or a topic; the application crawls the website, records evidence, calculates an explainable readiness score, stores findings, and exposes account-owned dashboard and report views.

## Current stack

- Next.js 16 / React 19 / TypeScript
- Vinext + Cloudflare Workers-compatible output
- Tailwind CSS 4 and reusable UI components
- Cloudflare D1 / SQLite with Drizzle migrations
- English and Arabic public interface, with independent indexable `/ar` routes for the homepage, 12 blog articles, and public information/policy pages

## Run locally

Requirements: Node.js 22.13+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test:entitlements
pnpm test:targets
pnpm test:plans
pnpm test:visibility
pnpm test:public
pnpm test:paypal
pnpm build
```

Database migrations are in `drizzle/`. Generate a new immutable migration after changing `db/schema.ts`:

```bash
pnpm db:generate
```

## Product status

Working now:

- URL, entity and topic analysis, with website readiness when applicable
- SSRF and fetch safety controls
- 24-hour result caching, one free analysis and bounded paid-beta usage
- Free/Starter/Essential/Growth/Pro catalog, scan-specific Starter purchase records, report access gates and project-slot limits
- Server-selected multi-model analysis policies, bounded page samples, evidence-linked action plans and advanced comparisons
- Leased monitoring endpoint and separate Cron Worker (requires deployment and secrets)
- Comparable measurement history, partial-coverage handling and per-run provider cost records
- Explainable findings and evidence report
- User-owned dashboard and scan history
- Product database foundation for subscriptions, fixes, credits, costs, audits, and support
- Read-only Fix Center review of real account-owned website findings, with evidence and source links; no execution or credits charged
- Grounded FAQ/blog assistant with human ticket escalation and a database-enforced hourly ticket cap per email
- Blog, FAQ, methodology, pricing, contact, privacy, terms, and billing-policy pages with Arabic counterparts, reciprocal language metadata, and a bilingual sitemap

Not yet connected:

- Google sign-in requires real OAuth credentials and hosted end-to-end sign-in acceptance on standalone deployments; code is present but its live configuration is not verified
- PayPal payment account/plan IDs and signed webhook integration require real Sandbox and Live acceptance; checkout remains disabled until approved
- Purchasable Fix Credits and a separately approved credit price catalog
- CMS apply/rollback integrations, explicit approval, version history and rollback for customer sites
- Production monitoring scheduler deployment and live model cost/quality acceptance; these depend on the configured providers

Read `ANALYSIS_HANDOFF_AR.md` for the latest analysis runtime and deployment steps. It supersedes older plan/monitoring instructions; `HANDOFF_AR.md` still provides the original hosting background.

No production credentials or customer data are included in this repository.

## Source and release safety (November 2026)

GitHub source and the existing ChatGPT Sites application have **separate source repositories**; a successful GitHub push or CI run does not automatically publish the hosted site. Read `DEPLOYMENT_SAFETY_AR.md` before transferring code or migrating databases. The last verified ChatGPT Sites deployment in this project's history was version 9. New changes in the GitHub feature branch must be promoted using the Sites deployment process and verified on the hosted origin.

An automated pull-request quality gate runs lint, TypeScript, functional/regression tests, and a Cloudflare-compatible build without activating paid services. These checks are not a substitute for browser accessibility, signed-in user acceptance, verified billing, live AI quality/cost checks or the domain-release review.
