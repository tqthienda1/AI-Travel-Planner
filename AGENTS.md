# AI Travel Planner

## stack

- Node.js 22+, pnpm 9.12.0, strict TypeScript; Fastify API and shared Zod schemas are implemented. React/Next.js and PostgreSQL are the intended product stack; the frontend/database integration is not implemented yet.
- Keep database access, model credentials, money calculations, and validation on the server. Thiện owns the application scaffold and CI.

## commands

- Install: `pnpm install --frozen-lockfile`. Checks: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`; aggregate: `pnpm check`.
- `node scripts/scan-secrets.mjs` scans working files, the staged index, and reachable Git history. `node --test tests/security/scan-secrets.test.mjs` runs only scanner regressions without a model or database; `pnpm test` includes them with workspace tests.
- Keep the exact check commands identical in README, this file, `package.json`, and CI. The test job needs full Git history for the scanner. CI is present; required status checks and branch protection still need separate evidence.

## conventions

- Name each branch exactly after its Jira ticket: `KAN-8`, `KAN-9`, or `KAN-10`. Use a PR into `main`; keep commits and red/green evidence intact.
- Follow [assistant permissions](docs/permissions.md). Existing user authorization takes precedence over routine permission prompts.
- Keep rules concise and deliverable documentation in English. Record actual AI contributions, changes, rejected suggestions, and evidence in `AI-LOG.md`. Keep internal handoffs and temporary review reports outside Git.
- Inspect quoted dotenv values with trailing `#` comments when changing the scanner; the original parser missed this syntax. Preserve the regression: [LOG-001](AI-LOG.md#log-001-quoted-env-comments).
- Scan the staged index as well as working files and reachable history before claiming a clean commit; a clean working file can hide a staged secret. Preserve the regression: [LOG-002](AI-LOG.md#log-002-staged-content).

## never

- Never put a model key, database credential, or other secret in Git, logs, the browser bundle, or any `NEXT_PUBLIC_` variable.
- Never call a real LLM in unit tests, or edit a test, eval dataset, or validator rule just to make a check pass.
- Never send names or email addresses to the model; send only places and interests.
- Never let the model read PostgreSQL directly or calculate money. It may use only `get_profile`, `search_places`, `get_menu`, `get_travel_time`, `get_weather`, `compute_cost`, and `validate_plan`; money is computed by code.
- Never bypass output-schema checks, the final backend validator, either user confirmation, or Save before group sharing. Keep the limits of 2 repair rounds, 12 tool calls, and 90 seconds.
- Never push directly to `main`, force-push, rebase completed work, fabricate incidents, or claim PR/CI results or provider settings without evidence.
