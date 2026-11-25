# PA#2 (IA2) — Harness & Quality Gate: Key Notes and Checklist

> **Course:** CSC13114 (2609-AWAD-23KTPM1)  
> **Product:** AI Travel Planner (Ho Chi Minh City weekend trip planner)  
> **Deadline:** Thursday, November 26, 2026, 22:00 (GMT+7)  
> **Weight:** 4% of course mark (100-point rubric)  
> **Team:** Long Ngô Bảo, Thịnh Nguyễn Đặng Đức, Trần Quốc Thiện

---

## 1. Critical Rules & Traps That Cost Heavy Marks

1. **Never push straight to `main` after enabling branch protection.**
   - Criterion 4 (20 pts) explicitly checks that *nothing has been pushed straight to `main` since protection was turned on*.
   - **Action:** Bootstrap the minimal repo structure first, then enable `main` branch protection immediately, and route **every** subsequent change through a Pull Request.
2. **Never rebase or rebuild Git history after work is finished.**
   - The rubric states: *"A history rebased or rebuilt after the work was finished does not count as evidence for criteria 4 and 6."*
   - Keep natural merge/PR commits so the red CI runs, blocked PRs, and fixes remain verifiable in GitHub and Git history.
3. **Never edit tests in the same commit as code to make CI pass (without a contract change).**
   - Doing so drops Criterion 6 (Contract tests that bite) straight to **0–2 / 15 points**.
   - In the deliberate contract break PR, intentionally break the implementation code while leaving tests untouched so CI turns red, then push a fix commit to the implementation code to turn CI green.
4. **Never commit any live secret or API key — even temporarily.**
   - A live secret in the submitted tree scores **0 / 10** on Criterion 2.
   - A secret in Git history (even if removed later) drops to **1–4 / 10** unless you **rotate the key** and document the incident + rotation in `AI-LOG.md`.
5. **Write all submission markdown deliverables in English.**
   - `PA2.md`, `AI-LOG.md`, and `SELF_ASSESSMENT_REPORT.md` **must be written in English**.
6. **Honesty Adjustment on Self-Assessment (`SELF_ASSESSMENT_REPORT.md`).**
   - Gap = `your claimed total − actual mark`:
     - Within `±10`: `0` penalty (normal calibration)
     - `+11 to +20`: `−3` pts
     - `+21 to +30`: `−6` pts
     - `> +30`: `−10` pts
     - `−21 or worse`: `−3` pts
     - Missing `SELF_ASSESSMENT_REPORT.md`: `−10` pts (and zip filename score is ignored)
   - Any criterion claimed **without an evidence link** (file, commit, PR, or CI run) is counted as *claimed-and-not-done*.

---

## 2. Rubric Breakdown & High-Band Requirements (Target: 90–100 pts)

### Criterion 1 — Rules File (15 pts)
- File: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, or `.github/copilot-instructions.md` (matching the tools your team actually uses).
- Must be **short** and contain **4 sections**: `stack`, `commands`, `conventions`, `never`.
- The `never` list must be specific to **AI Travel Planner**:
  - No model API key in the browser bundle.
  - No real model/LLM calls in unit tests.
  - Never edit a test, eval dataset, or validator rule just to make a check pass.
  - Never send user PII (names, email addresses) to the model — only places and interests.
  - Never let the model calculate money directly or bypass the 7 JSON tools / backend validator.
- **Must-have for 13–15 pts:** At least **2 lines** in the rules file must trace back to something that **actually went wrong** during PA#2, referencing a specific commit or `AI-LOG.md` entry.

### Criterion 2 — Permissions and Secrets (10 pts)
- Document assistant permissions in **3 explicit tiers**: `allowed`, `ask first`, `never`.
- Provide `.env.example` listing **every** environment variable with **empty values**; ignore `.env` in `.gitignore`.
- Zero secrets anywhere in Git history.
- Configure a **spending cap** on the model API key, and explicitly state the chosen model, estimated cost per plan, and spending cap in `README.md` (and `AI-LOG.md` per project brief Section 5).

### Criterion 3 — One Command for Every Check (10 pts)
- **Lint**, **format check**, **type check** (if applicable), and **tests** must each run via **one documented command**.
- Local commands in `README.md` and CI commands in `.github/workflows/` must be the **exact same commands**.
- Verify on a **fresh clone** following only `README.md` that every check passes cleanly.

### Criterion 4 — CI That Blocks a Merge (20 pts)
- Repository must be **public** (required both for PA#2 grading and for PA#4 red-teaming).
- `main` branch must be **protected**, with all checks from Criterion 3 marked as **required status checks**.
- Provide evidence in `PA2.md`:
  - Screenshot/proof of protected-branch settings.
  - Link to a **blocked PR** where a red check prevented merge.
  - Link to the **fix commit** that turned the PR green.
  - Clean `main` history (no direct pushes after protection was enabled).

### Criterion 5 — Contract of One AI Travel Planner Endpoint (25 pts)
- File path: `docs/contract/<endpoint>.md` (following the `CONTRACT.md` structure from IA#3).
- Recommended endpoints from rubric:
  - `POST /trips/{tripId}/plans` (idempotent agent run — retries must not start a second run)
  - `POST /plans/{planId}/save` (idempotent save & group share — must refuse any plan rejected by the backend validator)
  - `PUT /groups/{groupId}/members/{userId}/spending-cap` (member updates own cap only — define what happens to a saved plan that no longer fits)
  - `GET /places` (paged list — define behavior for unknown/unreadable filters)
- **Must-have for 21–25 pts:**
  - **Who may call it:** both **role** AND **ownership rule** (whose data — not just "authenticated").
  - **Request & response shapes** with explicit field validation rules.
  - **Every error** formatted as **RFC 9457 Problem Details** (`type`, `title`, `status`, `detail`, `instance`, etc.), listing every `type` URI and HTTP status code.
  - **Idempotency** (for create/publish) or **Paging** (for list).
  - **Change/evolution policy:** what happens when the contract changes (backward compatibility, versioning).
  - Self-contained enough that a stranger could implement a client from this file alone.

### Criterion 6 — Contract Tests That Bite (15 pts)
- Tests must strictly enforce the contract:
  - Every RFC 9457 error `type` and payload shape (not just HTTP status codes).
  - Ownership rule enforcement (another user's resource returns the exact status & error `type` named in the contract).
  - Paging or idempotency behavior where applicable.
- Tests must run inside the **required CI** pipeline.
- **Must-have for 13–15 pts:** Show **one deliberate break** — a PR/commit where the implementation intentionally violates the contract and CI goes **red**, followed by a code-only fix commit that turns CI **green**.

### Criterion 7 — `AI-LOG.md` (5 pts)
- Written in **English**.
- Log which AI tool was used for which part of the work.
- Include **real, specific `Changed / Rejected` entries** (e.g., an assistant-generated CI step that could never fail, a generic rule that was rewritten, or a contract gap caught during review). Generic or empty entries lose points.

---

## 3. Product Architecture Constraints to Keep in Mind (From Class Brief)

Even though the full LLM agent arrives in PA#3, your PA#2 rules, contract, and tests should already align with these **fixed constraints**:
- The LLM never reads the database directly and never computes money; it only calls **7 JSON tools** (`get_profile`, `search_places`, `get_menu`, `get_travel_time`, `get_weather`, `compute_cost`, `validate_plan`).
- Model output is schema-validated before reaching the validator.
- The **backend validator** always runs last before Save; nothing is shared with the group before Save.
- Hard execution limits: **2 repair rounds**, **12 tool calls**, **90 seconds**.
- Keys stay in the backend; only places and interests go to the model (never names or emails).
- Credit **OpenStreetMap**, **Wikimedia**, and **Open-Meteo** in the product.

---

## 4. Non-Blocking Team Workflow (Long, Thịnh, Thiện)

To avoid blocking each other before the Nov 26 deadline, work in **3 parallel tracks with disjoint file ownership**:

| Member | Track | Primary Files Owned | Key Deliverables |
|---|---|---|---|
| **Thiện** | Harness, CI/CD & Release | `.github/workflows/*`, build/lint/test config, `README.md`, `PA2.md`, `SELF_ASSESSMENT_REPORT.md` | One-command checks, CI workflow, branch protection, blocked PR evidence, tag `pa2`, final `.zip` |
| **Long** | AI Rules, Security & AI-LOG | `AGENTS.md` / `CLAUDE.md`, `.env.example`, `.gitignore`, `README.md` (security/spending cap), `AI-LOG.md` | 4-section Rules File (2+ traceable lines), 3-tier permissions, secret audit, spending cap docs, `AI-LOG.md` |
| **Thịnh** | Endpoint Contract & Tests | `docs/contract/<endpoint>.md`, endpoint module, `tests/contract/*` | RFC 9457 endpoint contract, minimal endpoint implementation, contract test suite, deliberate contract break PR |

### Parallel Execution Order
1. **Start immediately (Parallel Wave 1):**
   - **Thiện** bootstraps the repository & one-command checks (Criterion 3), then turns on `main` branch protection.
   - **Long** drafts the Rules file, 3-tier permissions, `.env.example`, spending cap section, and `AI-LOG.md` template.
   - **Thịnh** writes `docs/contract/<endpoint>.md` in full RFC 9457 detail (does not need to wait for code).
2. **PR Wave 2 (Parallel PRs against protected `main`):**
   - **Thiện** opens the intentional **Blocked PR** (CI red → fix → green) and captures branch-protection screenshot.
   - **Long** submits Rules/Permissions/Secrets PRs and updates at least 2 rules traced to real issues logged in `AI-LOG.md`.
   - **Thịnh** implements the minimal endpoint + full contract test suite PR, then opens the **Deliberate Contract Break PR** (CI red → code fix → green).
3. **Finalization (Wave 3):**
   - **Thiện** collects all PR/commit/CI links from Long and Thịnh into `PA2.md` and `SELF_ASSESSMENT_REPORT.md`.
   - Everyone double-checks their claimed rubric rows and evidence links.
   - Tag the final `main` commit as `pa2`, push the tag, confirm the CI run for tag `pa2` is green, and package the `.zip`.

---

## 5. Final Submission Checklist

- [ ] Repository is **public** on GitHub.
- [ ] `main` branch is protected with required CI checks; zero direct pushes after protection was enabled.
- [ ] No Git history rebase/rewrite after work finished.
- [ ] `PA2.md` (English) at repo root with links to:
  - [ ] Public repository
  - [ ] Protected-branch settings (screenshot/link)
  - [ ] Blocked PR (red check) & commit that turned it green
  - [ ] Deliberate contract break PR/commit (red check) & fix commit
  - [ ] CI run for tag `pa2`
- [ ] `AI-LOG.md` (English) at repo root with real `Changed / Rejected` entries.
- [ ] `SELF_ASSESSMENT_REPORT.md` (English) at repo root with 1 row per criterion, evidence links, "what we did not manage", and exact total.
- [ ] Final commit tagged `pa2` and pushed (`git tag pa2 && git push origin pa2`).
- [ ] Fresh clone test passes all documented check commands locally.
- [ ] Zip file includes `.git` and is named `<StudentID1>-<StudentID2>-<StudentID3>_<total>.zip` (IDs in ascending order; `<total>` matches `SELF_ASSESSMENT_REPORT.md`).
- [ ] Submitted by one team member using their `<StudentID>@student.hcmus.edu.vn` Google account before **Thu Nov 26, 2026, 22:00**.
