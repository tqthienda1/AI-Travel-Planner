# Assistant permissions

These permissions apply to the AI Travel Planner repository and the current authorized task. Explicit user instructions take precedence. Existing authorization carries forward: do not ask again for an action the user already authorized. A new external action outside that scope needs the relevant approval below. Sandbox and account permissions still apply.

## allowed

- Read repository files, public project documentation and connected Jira tickets needed for the task.
- Create and edit in-scope source, tests and documentation; use the agreed React/Next.js/PostgreSQL stack.
- Create local ticket branches and isolated worktrees, and make local commits when implementing an authorized task. Name each branch exactly after its ticket, for example `KAN-9`.
- Run local lint, formatting, type checks, tests and secret scans; use dummy data and mock model responses. Preserve existing tests and report failures honestly.
- Use sub-agents for the delegated work requested by the user, with separate file ownership and a parent reviewer. Review and fix local changes without another confirmation.

## ask first

- Publish branches, open PRs, change Jira issues or send messages to teammates when that external action was not included in the user's request. An explicit request already covering the action is sufficient authorization.
- Merge into `main`, deploy, change branch protection, delete remote data, rotate a live key, or rewrite Git history. The PA#2 evidence policy forbids rewriting finished history even when local cleanup would be convenient.
- Create or change provider credentials, project/account settings, or live PostgreSQL data. The user must review the exact external action and its effect.
- Make a live model call or enable any paid service. The current budget is zero: paid usage and automatic paid fallback require a new explicit budget decision, not an implementation assumption.
- Add dependencies or change shared tooling owned by another task when it materially expands the agreed scope; explain the concrete change and coordinate with its owner.

## never

- Commit or print credentials, database passwords, live `.env` values or private keys. Do not put model credentials in browser code or any sensitive `NEXT_PUBLIC_` variable.
- Send names, email addresses or other user PII to the model; only approved places and interests belong in model input.
- Call a real model in unit tests, fabricate AI-LOG incidents, claim an unrun check passed, or claim a provider spending control was enabled without evidence.
- Modify tests, eval datasets or validator rules merely to make a check pass. A legitimate requirement change needs an explicit contract decision and separately reviewable evidence.
- Let the model read the database directly, calculate money, bypass the seven JSON tools, skip output schema checks or bypass the backend validator.
- Share a plan before the user presses Save. Keep both user confirmations and the final server-side validator, including manual edits.
- Exceed the fixed 2 repair rounds, 12 tool calls or 90-second run limit, or bypass a failed required check/direct-push to protected `main`.

This document describes assistant actions. It does not grant OAuth access, GitHub permissions, model quota or database permissions.
