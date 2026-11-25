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

- [KAN-9 PR #6](https://github.com/tqthienda1/AI-Travel-Planner/pull/6) was merged
  into main at `e4086020c20925a57cd5eabbd5da6d12d256bd7b`.
- [CI run #12](https://github.com/tqthienda1/AI-Travel-Planner/actions/runs/45654519535)
  completed successfully for PR head `a618ff6505f95beeacb3be7c22188fec1a0ce4bb`.
- These are observed GitHub results, separate from the local checks above.
  They do not establish provider billing settings or the endpoint deliberate-break proof.

## Model and spending policy

- Selected provider/model: Groq API, `openai/gpt-oss-20b`, intended Free Plan.
- Estimated provider cost per plan: $0 while eligible for the verified Free Plan,
  excluding hosting/infrastructure. No runtime cost benchmark was performed.
- Paid API budget: $0/month; no paid upgrade or automatic paid fallback.
- This policy is not a configured provider cap. [Groq spend limits](https://console.groq.com/docs/spend-limits)
  are a paid-tier control. Free Plan account/quota evidence and acceptance of
  that alternative for the spending-cap rubric remain external requirements.

## Remaining evidence

Append actual ticket PR/CI links and teammates' AI contributions as they occur.
Required-check/protection settings, provider evidence and endpoint deliberate-
break proof must not be marked complete without evidence. No PA#2 release tag
or submission packaging was performed by this implementation.
