# AI Travel Planner

AI-assisted weekend itineraries for Ho Chi Minh City, built for CSC13114. The agreed stack is React, Next.js and PostgreSQL. The agent must use checked place data through seven backend JSON tools; code calculates money and validates plans before Save shares them with the group.

## Current state

This branch delivers the KAN-9 security setup. The repository does not yet contain the application scaffold, database schema, endpoint implementation or model integration. It cannot currently start a travel-planning application. Thiện owns the scaffold and application checks in KAN-5/KAN-6; Thịnh owns the API contract and endpoint tests in KAN-11/KAN-12.

## Run the available checks

Prerequisites: Git and Node.js 22 or newer. No npm dependencies, database or model key are needed for these checks. Run from the repository root:

```sh
node --test tests/security/scan-secrets.test.mjs
node scripts/scan-secrets.mjs
git diff --check
```

The scanner exits `0` when its configured patterns find nothing, `1` for policy findings and `2` when inspection is incomplete. It scans reachable Git history, the staged index and the working tree, including ignored local env files. Findings redact credential values. Read [scope and limitations](docs/security.md) before treating a clean result as evidence.

Application `lint`, `format:check`, `typecheck` and `test` commands are **pending KAN-5**. They are not runnable npm scripts today. Once the scaffold lands, Thiện must publish the same commands in `package.json`, this README, `AGENTS.md` and required CI. Add the standalone security tests and scanner to those checks without replacing the application contract tests. CI is not configured or claimed green by this branch.

For a fresh-clone verification, clone the relevant branch with full history, enter its root, and run the three commands above. A shallow checkout must be completed before the history scan can pass. Do not copy a real `.env` into the clone.

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
3. Copy `.env.example` to `.env.local` and fill the local values. Set `GROQ_MODEL` to `openai/gpt-oss-20b`. Obtain `DATABASE_URL` from the group's PostgreSQL setup; do not invent or commit credentials.
4. Record the verification date, organization/plan, model, actual quota limits and redacted plan/billing evidence in the PA#2 evidence handoff. No live model calls are needed for unit tests.

## Environment and security

Every value in `.env.example` is deliberately empty. The three variables are the **planned** server configuration; no application consumes them in this branch yet:

| Variable | Intended use |
| --- | --- |
| `DATABASE_URL` | Server-only PostgreSQL connection string |
| `GROQ_API_KEY` | Server-only Groq API credential |
| `GROQ_MODEL` | Server-only selected model identifier |

As implementation introduces variables, update this inventory and the empty example in the same change. No sensitive variable may use a `NEXT_PUBLIC_` prefix. The runtime boundary check is pending application code; the scanner is a development check, not a replacement for that boundary.

See [assistant permissions](docs/permissions.md), [secret-handling and verification](docs/security.md), and, after KAN-8/KAN-10 are integrated, `AGENTS.md`, `docs/workflow.md` and `AI-LOG.md`. Work on a branch whose name exactly equals its Jira ticket, such as `KAN-9`; preserve review evidence and use PRs rather than direct pushes to `main`.
