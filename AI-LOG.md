# AI assistance log

Date: 2026-11-25 (GMT+7). Owner: Long Ngo Bao.
Scope: KAN-8 (rules), KAN-9 (permissions/secrets), KAN-10 (AI log).
All entries below describe observed work. Internal agent handoffs and detailed
session transcripts are kept outside the repository.

## Tools and contributions

| Tool | Actual contribution |
| --- | --- |
| Codex coordinator | Read the brief/rubric and Jira tasks; integrated peer changes; reviewed fixes and ran checks |
| Codex rules sub-agent | Drafted AGENTS rules; independently reviewed security changes |
| Codex security sub-agent | Implemented permissions, env/ignore files, scanner and regression tests |
| Codex log/review sub-agent | Recorded actual decisions; independently reviewed parsing, coverage and evidence |
| Atlassian MCP | Read assignments and acceptance criteria; no ticket mutation |

## Changed / Rejected

### LOG-001: Quoted env comments

<a id="log-001-quoted-env-comments"></a>

- Observed: quoted dotenv passwords followed by `#` were missed; a later review
  also reproduced misses for opposite quote delimiters inside quoted values.
- Rejected: a parser covering only simple quoted values or provider prefixes.
- Changed: support the actual quote delimiter, escaped characters and comments.
- Evidence: `quoted dotenv passwords with inline hash comments are detected`,
  opposite/escaped-quote regressions in [security tests](tests/security/scan-secrets.test.mjs).
  Original comment case returned 0; the fixed scanner returns 1.
- Lesson: test generic passwords and valid dotenv syntax, not only token shapes.

### LOG-002: Staged content

<a id="log-002-staged-content"></a>

- Observed: a synthetic password remained in Git's index after its working file
  was cleaned; the first scanner returned 0 and missed the next commit's data.
- Rejected: treating current files plus committed history as sufficient.
- Changed: inspect `git ls-files --stage -z` blobs separately.
- Evidence: `staged secret remains visible after the working copy has been cleaned`;
  the fixed scanner returns 1. No live credential was used.
- Lesson: inspect the index, working files and reachable history before a commit.

### LOG-003: Placeholder exemptions

<a id="log-003-placeholder-exemptions"></a>

- Observed: literal passwords beginning `your_` or `replace_` bypassed detection.
- Rejected: assuming those prefixes prove a value is a placeholder.
- Changed: remove broad literal exemptions; retain narrow dynamic references.
- Evidence: `your_ prefix does not exempt an arbitrary literal password` changed
  from an observed scanner exit 0 to the expected exit 1.

### LOG-004: Shallow history

<a id="log-004-shallow-history"></a>

- Observed: shallow history could return a misleading clean result.
- Changed: reject a shallow repository with incomplete-inspection exit 2.
- Evidence: `shallow history fails closed instead of claiming an entire-history scan`.
- Integration: the test job uses `fetch-depth: 0` because `pnpm test` includes
  the history scan. The compatibility patch is on KAN-9 as well as KAN-8.

### LOG-005: Groq token coverage

<a id="log-005-groq-raw-keys"></a>

- Observed: a raw Groq-shaped key outside an assignment was not recognized.
- Changed: add the `groq-key` pattern and a synthetic raw-token/redaction test.
- Evidence: `raw Groq token outside an assignment is detected and redacted`.
  Reviewers reproduced the initial miss and verified the fixed finding.

### Additional review decisions

- Changed overlapping quoted-parser alternatives to exclude backslashes from
  the ordinary-character branch. A malformed-input regression with 1,000
  backslashes completes within its five-second subprocess timeout. No pre-fix
  hang was executed or claimed.
- Rejected an env-inventory test limited to `apps/api/src/index.ts`. It now
  checks application/shared modules, literal dot/bracket reads and conventional
  config parameters named `env`. Three added cases cover missing variables and
  excluded fixtures/build output. This is a text guard; aliases, computed keys
  and other limits still require review as explained in [security scope](docs/security.md).
- Preserved teammate KAN-5/KAN-6 code and existing Vitest checks when integrating
  security tests. No dependency or lockfile change was needed.

## Preserved failure/fix evidence

- Red: `2d79895e908bc9c4d7a79c733f50964f4ef092bb`.
- Code-only fix: `f3810db5f6c1851cd73b2c796e634a0b2b9b68ce`.
- The coordinator observed four regression failures before the fix and 15/15
  passing afterward. Only `scripts/scan-secrets.mjs` changed in the fix; the test
  blob was `7a8755a5dce22c603d137cdf8dec9df32fec8371` in both commits.
- These are local scanner regressions, not the endpoint's deliberate-break PR
  or proof of blocked GitHub merging. Do not rewrite this evidence.

## Latest validation

Reviewed source: KAN-9 `a708850072152b77fa52737b580117c98c64340a`, including
peer main `5c02ddf77d1066424e64e96dfcb58729bf3bd3d5`. The coordinator checked
that the combined KAN-8 executable/configuration files match this source.
Toolchain: Node 22.22.2, pnpm 9.12.0.

| Check | Actual local result |
| --- | --- |
| `pnpm lint` / `pnpm format:check` | Pass; 17 files each |
| `pnpm typecheck` | Both workspaces pass |
| `pnpm test` | 6 API tests and 24 security tests pass; history scan exits 0 |
| `pnpm check` | Aggregate exit 0 |

The scanner found no configured patterns within its documented scope. It is
heuristic and does not extract compressed PDF/archive content. Local success
is not hosted CI, required-check, branch-protection or production-build proof.
These local checks made no live model/database request or Jira update.
GitHub publication evidence is recorded below.

## Published evidence

- [KAN-5 PR #1](https://github.com/tqthienda1/AI-Travel-Planner/pull/1) was merged
  into main at `4a2c4e4` (scaffold + one-command checks).
- [KAN-6 PR #2](https://github.com/tqthienda1/AI-Travel-Planner/pull/2) was merged
  into main at `21ee0a2` (`.github/workflows/ci.yml`), [PR #3](https://github.com/tqthienda1/AI-Travel-Planner/pull/3)
  demonstrated a blocked red CI check (`45650169855`) and code-only fix (`a541f32` /
  green CI `45650304151`), and [PR #4](https://github.com/tqthienda1/AI-Travel-Planner/pull/4)
  added `docs/evidence/branch-protection.jpg`.
- [KAN-11 PR #5](https://github.com/tqthienda1/AI-Travel-Planner/pull/5) merged
  `docs/contract/post-plans-save.md`, [KAN-12 PR #8](https://github.com/tqthienda1/AI-Travel-Planner/pull/8)
  merged the endpoint and 23 contract tests, [KAN-13 PR #10](https://github.com/tqthienda1/AI-Travel-Planner/pull/10)
  demonstrated a deliberate contract break (`ae6f47b` -> red CI `45657450555` /
  `45657558258`, code-only fix `8ca561b` -> green CI `45657847229`), and
  [PR #11](https://github.com/tqthienda1/AI-Travel-Planner/pull/11) added red/green CI screenshots.
- [KAN-9 PR #6](https://github.com/tqthienda1/AI-Travel-Planner/pull/6) was merged
  into main at `e4086020c20925a57cd5eabbd5da6d12d256bd7b`.
- [CI run #12](https://github.com/tqthienda1/AI-Travel-Planner/actions/runs/45654519535)
  completed successfully for PR head `a618ff6505f95beeacb3be7c22188fec1a0ce4bb`.
- [KAN-10 PR #7](https://github.com/tqthienda1/AI-Travel-Planner/pull/7) merged
  `AI-LOG.md` and [KAN-8 PR #9](https://github.com/tqthienda1/AI-Travel-Planner/pull/9)
  merged `AGENTS.md`.
- These are observed GitHub results, separate from the local checks above.
  They do not establish provider billing settings.

## Teammate contributions — Trần Quốc Thiện (KAN-5, KAN-6, KAN-7)

Date: 2026-11-25 to 2026-11-26 (GMT+7). Owner: Trần Quốc Thiện.

### Tools and contributions

| Tool | Actual contribution |
| --- | --- |
| Antigravity assistant (Gemini models) | Scaffolded pnpm/TypeScript monorepo (`KAN-5`), drafted `.github/workflows/ci.yml` and Blocked PR demo (`KAN-6`), drafted `PA2.md` and `SELF_ASSESSMENT_REPORT.md` (`KAN-7`) |
| GitHub CLI (`gh`) | Created PRs #1–#4, configured and verified `main` Branch Protection rules via REST API, monitored CI runs |
| Atlassian MCP | Read Jira tasks (`KAN-4`..`KAN-13`), posted KAN-6 evidence comments, transitioned `KAN-5` and `KAN-6` to Done |

### Changed / Rejected

#### LOG-006: Windows CRLF line endings broke Biome on fresh clones (`KAN-5`)

- Observed: `biome format .` passed on initial local creation, but `biome.json` enforces `"lineEnding": "lf"` and fresh Windows checkouts normalized files to CRLF, failing `pnpm format:check`.
- Rejected: ignoring line-ending checks or formatting manually before each commit.
- Changed: added `.gitattributes` (`* text=auto eol=lf`) in commit `222181d` (PR #1) so fresh clones keep LF across Windows and Ubuntu CI runners.

#### LOG-007: CI workflow structure, `pnpm/action-setup` version conflict, and Branch Protection evidence (`KAN-6`)

- Observed: combining all checks into one CI job would produce only one status check context, and passing `version:` to `pnpm/action-setup@v4` conflicts with `"packageManager": "pnpm@9.12.0"` in `package.json`. Additionally, the first user screenshot of `Settings -> Branches` showed only the summary row without expanded rule checkboxes.
- Rejected: single-job CI, redundant `version:` input on `pnpm/action-setup@v4`, leaving `enforce_admins` disabled, and keeping the summary-only screenshot as Branch Protection evidence.
- Changed: split CI into 4 parallel required jobs (`lint`, `format-check`, `typecheck`, `test`) matching `README.md` 1-to-1, enabled `enforce_admins: true` (verified via Blocked PR #3: red commit `d271755` / run `45650169855` -> code-only fix `a541f32` / run `45650304151`), and captured the expanded rule view (`docs/evidence/branch-protection.jpg`, PR #4).

#### LOG-008: Honest self-assessment calibration & pre-tag sequencing (`KAN-7`)

- Observed: Groq's configurable spending cap applies only to paid tiers, and `AI-LOG.md` still awaited Thịnh's contract-track entries after PR #11 merged.
- Rejected: claiming `10/10` on Criterion 2 without dashboard spending-cap evidence, or prematurely tagging `pa2` and packaging `.zip` before Thịnh appends his `AI-LOG.md` entries.
- Changed: calibrated `SELF_ASSESSMENT_REPORT.md` to `95/100` (deducting `-2` honestly on Criterion 2 and `-1` calibration buffers on C1, C5, C6) and deferred `pa2` tagging / `.zip` packaging until Thịnh's `AI-LOG.md` PR lands on `main`.

## Teammate contributions — Thịnh Nguyễn Đặng Đức (KAN-11, KAN-12, KAN-13)

Date: 2026-11-25 to 2026-11-26 (GMT+7). Owner: Thịnh Nguyễn Đặng Đức.

### Tools and contributions

| Tool | Actual contribution |
| --- | --- |
| Antigravity assistant (Gemini models) | Drafted the RFC 9457 endpoint contract `docs/contract/post-plans-save.md` (`KAN-11`), implemented the minimal `POST /plans/{planId}/save` endpoint (`apps/api/src/plans-save/*`) and 23 contract tests (`apps/api/tests/contract/post-plans-save.test.ts`) (`KAN-12`), created the deliberate contract break commit and code-only fix (`KAN-13`), and audited final PA#2 submission deliverables |
| Atlassian MCP | Read assigned Jira tasks (`KAN-11`, `KAN-12`, `KAN-13`) and acceptance criteria; write transitions returned `Unauthorized: rejected by transport`, so ticket statuses were updated directly in Jira |

### Changed / Rejected

#### LOG-009: Control-character regex lint failure, strict header typing, and secret-scanner compatibility (`KAN-12`)

- Observed: Before committing `KAN-12`, `pnpm lint` failed with 4 Biome `lint/suspicious/noControlCharactersInRegex` errors on the regex validating forbidden control characters in `note` (`apps/api/src/plans-save/schema.ts`), and `pnpm typecheck` failed with `TS2345` in `apps/api/tests/contract/post-plans-save.test.ts` because Node's `OutgoingHttpHeaders` permits numeric header values in `assertProblemDetails`. Additionally, `scripts/scan-secrets.mjs` inspects literal assignments `>= 8` characters on names matching `token|secret|api_key`, which can trigger false findings on naively named test JWT fixtures.
- Rejected: suppressing Biome lint errors with ignore comments, relaxing TypeScript strictness, or editing `scripts/scan-secrets.mjs` to exclude test files.
- Changed: replaced the regex with an explicit `hasForbiddenControlChars()` char-code loop in `apps/api/src/plans-save/schema.ts`, typed `assertProblemDetails` headers as `Record<string, string | number | string[] | undefined>`, and used non-sensitive fixture names (`DEFAULT_LOCAL_HMAC_KEY`, `bearerHeader`) so `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `vitest run` (`29/29`), `pnpm test:security` (`24/24`), and `pnpm secrets:check` (`0` findings) all passed cleanly in PR #8 (`7b92458`).

#### LOG-010: Closure ordering failure in concurrent `409 idempotency-in-progress` contract test (`KAN-12`)

- Observed: On the initial local Vitest run for `KAN-12`, `28/29` tests passed while the concurrent duplicate request test threw `ReferenceError: Cannot access 'gatePromise' before initialization` because the test barrier closure referenced a `let` binding before initialization.
- Rejected: skipping the concurrent in-flight lock contract assertion or falling back to flaky `setTimeout` delays.
- Changed: rewrote the test synchronization helper in `apps/api/tests/contract/post-plans-save.test.ts` with two explicit promises (`firstEntered` and `waitGate`) so the overlapping second request deterministically hits the in-flight idempotency lock and verifies `409 idempotency-in-progress` with `Retry-After: 1` before releasing the first request.

#### LOG-011: Two-phase push sequencing for deliberate contract break & separate screenshot PR (`KAN-13`)

- Observed: Pushing both the contract-breaking commit and the fix commit to `KAN-13` before opening PR #10 would cause GitHub Actions to run only on the final green head, losing the required red CI proof for Criterion 6. Committing PNG screenshots directly into PR #10 would also pollute the code-only break/fix diff. Furthermore, GitHub's "Update branch" merged `main` into `origin/KAN-13` (`eea3dd0`) while PR #10 was open.
- Rejected: pushing both commits together, rebasing or force-pushing over `eea3dd0`, or mixing screenshot files into PR #10.
- Changed: pushed Commit 1 (`ae6f47b`, modifying only `apps/api/src/plans-save/route.ts` with zero test changes) first and verified GitHub Actions failed exclusively on `test` (`45657450555` / `45657558258`, with `lint`, `format-check`, and `typecheck` green), then fast-forwarded `origin/KAN-13` (`eea3dd0`) and pushed code-only Commit 2 (`8ca561b` -> green CI `45657847229`, merged `c6d28fa`), and submitted the 3 screenshots separately via PR #11 (`KAN-13-evidence`, `86bcf6f`).

## Model and spending policy

- Selected provider/model: Groq API, `openai/gpt-oss-20b`, intended Free Plan.
- Estimated provider cost per plan: $0 while eligible for the verified Free Plan,
  excluding hosting/infrastructure. No runtime cost benchmark was performed.
- Paid API budget: $0/month; no paid upgrade or automatic paid fallback.
- This policy is not a configured provider cap. [Groq spend limits](https://console.groq.com/docs/spend-limits)
  are a paid-tier control. Free Plan account/quota evidence and acceptance of
  that alternative for the spending-cap rubric remain external requirements.

## Remaining evidence

- Final team sign-off on `SELF_ASSESSMENT_REPORT.md`, final `pa2` tag on `main` + green tag CI run, and external redacted Groq Free Plan dashboard evidence if available.
