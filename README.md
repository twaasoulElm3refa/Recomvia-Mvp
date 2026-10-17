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
- English and Arabic public interface

## Run locally

Requirements: Node.js 22.13+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm typecheck
pnpm test:entitlements
pnpm test:targets
pnpm test:plans
pnpm test:visibility
pnpm test:public
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
- Grounded FAQ/blog assistant with human ticket escalation
- Blog, FAQ, methodology, pricing, contact, privacy, terms, and billing-policy pages

Not yet connected:

- Google OAuth outside the current hosted environment
- Payment processor and subscription webhooks
- Purchasable Fix Credits
- CMS apply/rollback integrations

Read `ANALYSIS_HANDOFF_AR.md` for the latest analysis runtime and deployment steps. It supersedes older plan/monitoring instructions; `HANDOFF_AR.md` still provides the original hosting background.

No production credentials or customer data are included in this repository.
