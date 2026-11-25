# Secret handling and verification

## Local configuration

Only commit `.env.example`, with every assignment empty. Keep `.env`, `.env.local` and other local env files ignored. The root ignore rules also exclude private-key and common service-account credential files; ignore rules are not a secret detector. `git check-ignore` behaviour is verified by the standalone tests.

Groq requests must originate in server code when model integration is implemented. `GROQ_API_KEY` and `DATABASE_URL` must never enter a browser bundle, error response or log. KAN-5 now supplies the Fastify health API, but no model client, database integration or Next.js frontend exists yet; this branch does not claim those runtime boundaries or a built browser bundle have been tested. The API currently reads `HOST` and `PORT` from its process environment. `.env.example` inventories those two existing variables and the three planned integration variables, with all values empty; the API does not automatically load `.env.local` today.

## Run a secret scan

```sh
node scripts/scan-secrets.mjs
```

Run from the repository root with Git and Node.js 22+. The command inspects:

1. Every blob reachable through local Git refs, including fetched remote branches and tags, even if its file was deleted from the current tree. It maps paths from all reachable commits so an `.env.example` rename cannot evade its empty-value policy.
2. Staged index blobs, including a staged secret whose working copy has already been cleaned.
3. Current regular working files, including untracked and Git-ignored env files. It skips `.git`, `node_modules`, `.pnpm-store`, `.next`, `out`, `build`, `dist` and `coverage` entries in this working-file walk. History blobs are not excluded by these names.

Rules detect recognizable private-key headers, common provider-token shapes, password-bearing database URLs, literal assignments to sensitive names, forbidden sensitive `NEXT_PUBLIC_` names, and nonempty `.env.example` assignments. Diagnostic records contain only rule, file path, line and source (blob hash or working tree/index), never the matched value. Do not add credential excerpts to review comments or AI-LOG.

Exit meanings:

| Exit | Meaning |
| --- | --- |
| `0` | No configured pattern matched in the inspected scope |
| `1` | One or more secret-policy findings; investigate before committing/publishing |
| `2` | Incomplete inspection, such as Git failure, shallow history, submodule, symlink or oversized object; do not treat this as clean |

The root `pnpm test` now runs the existing Vitest suite, `pnpm test:security` and then `pnpm secrets:check`; `pnpm check` includes that root test command. For CI integration, use a full checkout and the documented commands. Thiện owns that integration in KAN-6; no GitHub workflow or required-check setting is supplied by KAN-9.

## What the scan cannot prove

This is a small heuristic scanner, not a comprehensive secret audit. It can miss unfamiliar, split, encoded or obfuscated credentials. Binary/non-UTF8 content is searched as raw bytes only: compressed PDF content, images and embedded archives are not extracted or OCRed. The supplied PDFs therefore have no comprehensive embedded-secret guarantee. It does not inspect unreachable/dangling objects, reflog-only history, Git LFS remote payloads, GitHub Actions secrets, provider dashboards or remote branches that have not been fetched. Fetch authorized refs before reporting history evidence. History traversal and Git output are bounded to 32 MiB per operation; oversized input fails instead of silently passing. Reachability includes HEAD, including a detached HEAD, and the inspected refs.

Use source review and provider evidence alongside the result. Report “no configured patterns found” with ref/date/command and these limits, never “there are zero secrets anywhere.”

## Findings and response

If a credential is discovered, stop publishing affected changes, identify its owner without exposing the value, and arrange rotation through the approved account owner. Removing a file does not revoke a key. Preserve the incident and rotation evidence in `AI-LOG.md`; never rewrite finished PA#2 history to hide it. Rerun the scanner and document any historical detection that remains after rotation rather than suppressing it just to get a green check.

## Tests

```sh
node --test tests/security/scan-secrets.test.mjs
```

Tests create disposable local Git repositories, synthesize dummy credential strings at runtime, and never call a model, database or external service. They verify history deletion, alternate refs, path aliases, ignored env files, staged data, incomplete history, public variable naming, dotenv parsing, empty examples and redacted diagnostics. They also test `.gitignore` with `git check-ignore`. The scanner's negative and incomplete cases must return nonzero; success-only checks would not establish a useful gate.

## Provider budget evidence

The chosen model, cost estimate, official references and owner setup steps are in the README. Current policy: Groq API Free Plan, `openai/gpt-oss-20b`, no paid upgrade/fallback, paid API budget 0 USD/month. Account controls are external and **not yet verified**. Required handoff evidence is a redacted Free Plan/billing-state capture, date, selected model and organization-specific quota limits. Groq configurable spend caps apply only to paid tiers: no $0 cap has been configured, and the rubric interpretation remains unresolved. Do not enable billing merely to satisfy that rubric. Do not store an API key or a screenshot containing one. Unit tests do not require a key, so they may run before provider setup.
