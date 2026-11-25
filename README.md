# AI Travel Planner

CSC13114 (`2609-AWAD-23KTPM1`) class project — an AI-assisted weekend trip schedule and budget planner for Ho Chi Minh City.

## Current state

KAN-5 supplies a runnable TypeScript/Fastify API with a health route and shared Zod/RFC 9457 helpers. The agreed React/Next.js frontend and PostgreSQL integration are not implemented yet; no travel-planning endpoint, database schema or model client is present. This branch adds the KAN-9 security setup. Thiện owns CI and branch protection in KAN-6; Thịnh owns the API contract and endpoint tests in KAN-11/KAN-12.

## Stack

- **Runtime:** Node.js `>= 22.0.0`
- **Package Manager:** pnpm `>= 9.0.0` (workspace monorepo)
- **Language:** TypeScript (strict mode)
- **Backend API:** Fastify + Zod (`apps/api`)
- **Shared Schemas & Types:** Zod + RFC 9457 Problem Details (`packages/shared`)
- **Planned frontend/data:** React + Next.js, PostgreSQL
- **Quality Gate:** Biome (lint & format), `tsc --noEmit` (typecheck), Vitest (tests)

## Repository Layout

```text
.
├── apps/
│   └── api/              # Fastify API server, routes, and tests
├── packages/
│   └── shared/           # Shared Zod schemas, types, and RFC 9457 helpers
├── docs/                 # Project briefs and endpoint contracts
├── biome.json            # Lint & formatting rules
├── tsconfig.base.json    # Shared strict TypeScript config
└── vitest.config.ts      # Workspace test runner config
```

## Getting Started (Fresh Clone)

1. Install prerequisites: **Node.js >= 22** and **pnpm 9.12.0** (the pinned `packageManager` version).
2. Install dependencies:

```bash
pnpm install --frozen-lockfile
```

3. Run all quality checks. CI must use these exact commands when KAN-6 is integrated; this branch does not yet supply CI or claim required checks are enabled:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

Or run every check in sequence with one wrapper command:

```bash
pnpm check
```

## Standard Check Commands

Every check has one documented local command; use these same commands in CI:

| Check | Command | Tool |
|---|---|---|
| Lint | `pnpm lint` | Biome (`biome lint .`) |
| Format check | `pnpm format:check` | Biome (`biome format .`) |
| Type check | `pnpm typecheck` | TypeScript (`tsc --noEmit` across workspaces) |
| Tests | `pnpm test` | Vitest, Node security tests, then secret scan |
| Auto-format (local fix) | `pnpm format` | Biome (`biome format --write .`) |

## Security checks

`pnpm test` preserves the existing `vitest run`, then runs `pnpm test:security` and `pnpm secrets:check`. Its failure propagates from any stage. The standalone checks need only Git and Node.js 22+, with no database or model key:

```sh
pnpm test:security
pnpm secrets:check
```

Or run them without pnpm/dependencies:

```sh
node --test tests/security/scan-secrets.test.mjs
node scripts/scan-secrets.mjs
```

The scanner exits `0` when configured patterns find nothing, `1` for policy findings and `2` for incomplete inspection. It covers reachable history, the index and working files including ignored local env files, with redacted diagnostics. Read [scope and limitations](docs/security.md). A shallow checkout must be completed before scanning. Never copy real local credentials into a verification clone.

## Local Development

Start the API server in watch mode:

```bash
pnpm dev:api
```

Health check endpoint:

```bash
curl http://localhost:3001/health
```

## Attribution

Data attributions required by the project brief: OpenStreetMap, Wikimedia, and Open-Meteo.

## Model, cost and zero-spend policy

The selected provider is **Groq API**, using **`openai/gpt-oss-20b` on the Free Plan**. This is an API choice, not a local model. Official references:

- [Available models](https://console.groq.com/docs/models)
- [Structured outputs](https://console.groq.com/docs/structured-outputs)
- [Rate limits](https://console.groq.com/docs/rate-limits)
- [Billing FAQ](https://console.groq.com/docs/billing-faqs)
- [Spend limits](https://console.groq.com/docs/spend-limits)

**Budget: 0 USD/month in paid API charges.** Estimated provider cost per plan is **0 USD only while requests remain eligible under the verified Free Plan**. This estimate excludes hosting and other infrastructure. Model performance, request count and end-to-end plan quality have not been measured yet. Do not upgrade to the Developer Plan, add a payment method or use a paid fallback without a new explicit budget decision. No live model request was made during these checks.

The intended account-side control is to keep the organization on the **Free Plan** and stop when its quota is exhausted. **The actual account plan, payment state, key restrictions and quotas still require owner verification before live use.** Groq's configurable spend cap is available only on a paid tier; spend tracking updates every 10–15 minutes and may allow overruns, so it is not a hard real-time cap. This branch does not claim a $0 provider cap has been configured. On Free, that configurable cap is **not applicable**. This is a rubric gap to clarify with Thiện/the lecturer, not a reason to enable paid billing. A local budget variable or this written policy is not proof of provider enforcement. KAN-9 remains partial until external account evidence and the spending-cap rubric decision exist.

As checked on 2026-11-25, the published Free Plan table for this model lists 30 RPM, 1,000 RPD, 8,000 TPM and 200,000 TPD. Limits apply at organization level; the actual account dashboard is authoritative and limits can change. Planning example: 20 plans/day × 3 model requests/plan × 2,000 tokens/request is about 120,000 tokens/day. This is an estimate, not a benchmark or guaranteed capacity; prompt/output/reasoning token accounting and the 8,000 TPM limit still matter. Code may call tools in a fixed sequence, leaving the model to score candidates and propose the day frame, as allowed by the project brief. The fixed two confirmations and backend validator remain. Twelve tool calls do not necessarily mean twelve model calls. Quota errors should stop the AI attempt or leave the user in manual mode, never trigger paid fallback. These runtime behaviours remain application-integration requirements.

Owner setup, once application integration is ready:

1. Verify the Groq organization is on the Free Plan, has not been upgraded to paid billing, and can access the selected model within its quotas.
2. Create a dedicated server-side API key and apply available restrictions. Keep it out of chat, Git, screenshots and browser code.
3. Copy `.env.example` to `.env.local` and fill the local values for future model/database integration. The current Fastify process does not automatically load that file; it reads its process environment. Set `GROQ_MODEL` to `openai/gpt-oss-20b`. Obtain `DATABASE_URL` from the group's PostgreSQL setup; do not invent or commit credentials.
4. Record the verification date, organization/plan, model, actual quota limits and redacted plan/billing evidence in the PA#2 evidence handoff. No live model calls are needed for unit tests.

## Environment and security

Every value in `.env.example` is deliberately empty. The inventory covers the two variables currently read by the API process and three planned server-only integration variables:

| Variable | Intended use |
| --- | --- |
| `HOST` | API listen address; defaults to `0.0.0.0` when unset |
| `PORT` | API listen port; defaults to `3001` when unset |
| `DATABASE_URL` | Server-only PostgreSQL connection string |
| `GROQ_API_KEY` | Server-only Groq API credential |
| `GROQ_MODEL` | Server-only selected model identifier |

As implementation introduces variables, update this inventory and the empty example in the same change. No sensitive variable may use a `NEXT_PUBLIC_` prefix. The model/database runtime boundary check is pending integration; the scanner is a development check, not a replacement for that boundary.

See [assistant permissions](docs/permissions.md), [secret-handling and verification](docs/security.md), `AGENTS.md` and `AI-LOG.md`. Work on a branch whose name exactly equals its Jira ticket, such as `KAN-9`; preserve review evidence and use PRs rather than direct pushes to `main`.
