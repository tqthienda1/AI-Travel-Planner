# Endpoint Contract: `POST /plans/{planId}/save`

- **Contract ID:** `ai-travel-planner.plans.save`
- **Contract Version:** `1.0.0` (API major `v1`)
- **Status:** Normative (PA#2 Milestone — Criterion 5)
- **Method & Path:** `POST /plans/{planId}/save`
- **Request Content-Type:** `application/json` (UTF-8)
- **Success Response Content-Type:** `application/json; charset=utf-8`
- **Error Response Content-Type:** `application/problem+json` (RFC 9457)
- **Currency & Timezone:** All monetary amounts are integers in Vietnamese Dong (`VND`, 1 unit = 1 VND). Local schedule times (`HH:MM` and `YYYY-MM-DD`) are interpreted in `Asia/Ho_Chi_Minh` (`UTC+07:00`). All timestamps (`*At`) are RFC 3339 UTC strings ending in `Z`.

---

## 1. Purpose & Architectural Role

`POST /plans/{planId}/save` is the **final confirmation, validation, persistence, and group-sharing gate** (Step 6 of the AI Travel Planner flow).

Before this endpoint succeeds, a plan exists only as a private draft visible to its creator — **nothing is shared with the group prior to Save**. When called, the backend:

1. Authenticates the caller and enforces role and ownership rules.
2. Enforces request schema, idempotency, lifecycle state, and optimistic concurrency (`expectedRevision`).
3. Applies optional last-minute manual edits in memory (without mutating the database yet).
4. Recomputes all costs deterministically in backend code (`compute_cost`) using checked place and menu data — **never trusting client-supplied or LLM-supplied totals**.
5. Runs the deterministic backend validator (`validate_plan`) across all five mandatory product invariants:
   - every place and menu item exists in the checked Ho Chi Minh City dataset (and has verified opening hours and menu data);
   - every stop falls within the place's opening hours for that weekday (and is not closed for a public holiday);
   - precomputed motorbike travel time fits within the gap between every pair of consecutive stops;
   - every member's estimated spending stays within their personal cap (and the lowest personal spending cap in a group trip), and the group total stays within the group budget;
   - no outdoor stop is scheduled during any hour where the 7-day Open-Meteo rain probability exceeds `60%`.
6. **Atomically** persists the saved plan, increments its revision, publishes it to the group (when `shareWithGroup: true`), and records the idempotency result.

If **any** check fails, **no state is mutated and nothing is shared with the group**.

---

## 2. Who May Call It (Authentication, Roles & Ownership Rules)

> This endpoint is **not** simply "authenticated". Access requires a valid session, an allowed role, **and** satisfaction of the resource ownership rule for the target plan.

### 2.1 Authentication

- Every request MUST include `Authorization: Bearer <access_token>`, where `<access_token>` is a signed JWT issued by the AI Travel Planner authentication service.
- The verified token MUST provide:
  - `sub` (`userId`, UUIDv4)
  - `role` (`"member" | "business" | "admin"`)
  - `exp` (unexpired UTC epoch)
- Missing, malformed, invalid-signature, revoked, or expired tokens return **`401 Unauthorized`** with `type: https://ai-travel-planner.local/problems/unauthorized`.

### 2.2 Role Rules

| Role | Permitted to call `POST /plans/{planId}/save`? | Reason |
|---|---|---|
| `member` | **Yes** (subject to Ownership Rules below) | Standard traveler account creating individual or group schedules. |
| `business` | **No** (`403` `forbidden-role`) | Business accounts manage promotional posts only and may never save or share travel plans. |
| `admin` | **No** (`403` `forbidden-role`) unless acting with a `member` account that satisfies ownership | Admins moderate posts and inspect reports; they cannot publish schedules into a user's or group's trip. |

### 2.3 Ownership Rules (Whose Data)

A plan belongs to a trip (`tripId`), which has a `mode` of either `"individual"` or `"group"`:

1. **Individual trip (`trip.mode === "individual"`):**
   - **Owner:** `plan.ownerUserId` (always equal to `trip.ownerUserId` and `plan.createdByUserId`).
   - **Rule:** ONLY the user with `caller.userId === plan.ownerUserId` may call this endpoint.
   - **Forbidden callers:** Every other authenticated `member` receives **`403 Forbidden`** with `type: https://ai-travel-planner.local/problems/ownership-violation`.

2. **Group trip (`trip.mode === "group"`):**
   - **Owners / Stakeholders:** The draft belongs privately to its creator (`plan.createdByUserId`) within `trip.groupId` until Save; once saved, the schedule is shared with all active members of `trip.groupId`.
   - **Rule:** The caller MUST satisfy **both** conditions:
     1. `caller.userId` is currently an **active** member of `trip.groupId` (`membership.status === "active"`; `invited`, `left`, or `removed` users are rejected).
     2. `caller.userId === plan.createdByUserId` (a group member cannot prematurely publish another member's private unsaved draft).
   - **Forbidden callers:**
     - Authenticated `member` who is not an active member of `trip.groupId` → **`403 Forbidden`** (`ownership-violation`).
     - Active member of `trip.groupId` who is **not** `plan.createdByUserId` → **`403 Forbidden`** (`ownership-violation`).
     - Former member who created a draft and was subsequently removed from `trip.groupId` → **`403 Forbidden`** (`ownership-violation`).

> **Note on `403` vs `404`:** Because `planId` is a randomly generated UUIDv4 (122 bits of entropy, infeasible to enumerate), non-existent `planId` values return **`404 Not Found`** (`plan-not-found`), whereas existing plans failing ownership checks return **`403 Forbidden`** (`ownership-violation`). Clients MUST handle both explicitly.

### 2.4 Authorization Matrix

| Caller Scenario | Allowed | HTTP Status | Problem `type` |
|---|:---:|:---:|---|
| No `Authorization` header / invalid or expired JWT | No | `401` | `.../problems/unauthorized` |
| Role is `business` or `admin` | No | `403` | `.../problems/forbidden-role` |
| `member`, `planId` does not exist | No | `404` | `.../problems/plan-not-found` |
| `member`, individual trip, `caller.userId !== plan.ownerUserId` | No | `403` | `.../problems/ownership-violation` |
| `member`, group trip, caller not active in `trip.groupId` | No | `403` | `.../problems/ownership-violation` |
| `member`, group trip, active member but `caller.userId !== plan.createdByUserId` | No | `403` | `.../problems/ownership-violation` |
| `member`, individual trip, `caller.userId === plan.ownerUserId` | **Yes** | `200` (or validation/state error) | — |
| `member`, group trip, active in `trip.groupId` AND `caller.userId === plan.createdByUserId` | **Yes** | `200` (or validation/state error) | — |

---

## 3. Request Specification

### 3.1 Path Parameters

| Parameter | Type | Required | Constraints | On Violation |
|---|---|:---:|---|---|
| `planId` | `string` | Yes | Lowercase UUIDv4 matching `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` | `400` `invalid-request` |

### 3.2 Request Headers

| Header | Required | Format & Constraints | On Violation |
|---|:---:|---|---|
| `Authorization` | Yes | `Bearer <jwt>` | `401` `unauthorized` |
| `Content-Type` | Yes | `application/json` (optional `; charset=utf-8` parameter) | `415` `unsupported-media-type` |
| `Idempotency-Key` | Yes | ASCII token `^[A-Za-z0-9._-]{16,128}$` (UUIDv4 strongly recommended) | `400` `invalid-idempotency-key` |
| `Accept` | No | Recommended: `application/json, application/problem+json` | Ignored if omitted |

### 3.3 Request Body Schema & Field Rules

- **Maximum body size:** `65,536` bytes (`64 KiB`). Larger payloads return `413` `payload-too-large`.
- **Strict schema (`additionalProperties: false`):** Any unrecognized field at top level or inside nested objects is rejected with `400` `invalid-request`.
- **Forbidden client assertions:** Clients MUST NOT send prices, budgets, weather values, travel times, or `validationPassed` flags; any such unknown fields are rejected with `400` `invalid-request`.

#### Top-Level Object

| Field | Type | Required | Default | Rules & Constraints |
|---|---|:---:|---|---|
| `expectedRevision` | `integer` | Yes | — | Optimistic concurrency guard. Integer `>= 1`. Must equal the plan's current `revision` (except during same-key idempotent replay). Mismatch returns `409` `revision-conflict`. |
| `shareWithGroup` | `boolean` | No | `true` for `group` trips; `false` for `individual` trips | Explicit publish flag. Must be `false` (or omitted) when `trip.mode === "individual"`; sending `true` on an individual trip returns `400` `invalid-request`. |
| `note` | `string \| null` | No | `null` | Optional message displayed to the group alongside the shared schedule. Trimmed before storage; empty string normalizes to `null`. Max `280` UTF-16 code units. Control characters (`U+0000`–`U+001F` except `\n`, and `U+007F`) are forbidden. **Never forwarded to any LLM.** |
| `edits` | `object` | No | *(omit to save current draft unchanged)* | Optional manual edits applied atomically before cost computation and backend validation. When present, replaces the draft's `days` array in full. |

#### `edits` Object (Optional)

| Field | Type | Required | Rules & Constraints |
|---|---|:---:|---|
| `edits.days` | `DayScheduleInput[]` | Yes (when `edits` is present) | Non-empty array, length `1..7`. Dates must be unique and sorted in ascending chronological order. Every `date` must lie within `[trip.startDate, trip.endDate]` (inclusive). |

#### `DayScheduleInput` Object

| Field | Type | Required | Rules & Constraints |
|---|---|:---:|---|
| `date` | `string` | Yes | ISO-8601 calendar date `YYYY-MM-DD` (valid Gregorian date in `Asia/Ho_Chi_Minh`). |
| `stops` | `StopInput[]` | Yes | Non-empty array, length `1..12` stops per day. Stops must be ordered by ascending `startTime`. |

#### `StopInput` Object

| Field | Type | Required | Rules & Constraints |
|---|---|:---:|---|
| `stopId` | `string` | No | Optional lowercase UUIDv4 referencing an existing draft stop. If omitted, the backend generates a new UUIDv4. Duplicate `stopId` values within the same request return `400` `invalid-request`. |
| `placeId` | `string` | Yes | Checked place identifier matching `^[a-z0-9_-]{3,64}$` (e.g., `plc_hcmc_014`). Existence in the checked dataset is enforced by the backend validator (`422` `plan-validation-failed`, `PLACE_NOT_FOUND`). |
| `startTime` | `string` | Yes | 24-hour local HCMC time `HH:MM` matching `^([01][0-9]|2[0-3]):[0-5][0-9]$`. |
| `endTime` | `string` | Yes | 24-hour local HCMC time `HH:MM` matching `^([01][0-9]|2[0-3]):[0-5][0-9]$`. Must satisfy `endTime > startTime` and `(endTime - startTime) >= 15` minutes (no midnight wrap-around within a single stop). |
| `selectedItems` | `SelectedItemInput[]` | Yes | Array of chosen menu items, length `0..10`. May be `[]` for free places or ticket-only landmarks. Duplicate `menuItemId` values within the same stop return `400` `invalid-request`. |

#### `SelectedItemInput` Object

| Field | Type | Required | Rules & Constraints |
|---|---|:---:|---|
| `menuItemId` | `string` | Yes | Checked menu item identifier matching `^[a-z0-9_-]{3,64}$`. Must belong to the parent stop's `placeId` (enforced by validator: `422` `plan-validation-failed`, `MENU_ITEM_NOT_FOUND`). |
| `quantity` | `integer` | Yes | Integer in range `1..20`. |
| `assignedMemberIds` | `string[]` | No | Optional array of unique active group member UUIDv4s (`1..20` elements). In `individual` mode, MUST be omitted or `[ownerUserId]`. In `group` mode, omitting it splits the item cost equally across all active group members. Non-member IDs return `400` `invalid-request`. |

### 3.4 Server Processing & Validation Order

Requests are evaluated in the following deterministic order so error responses are predictable across implementations:

1. **Content-Type & Payload Size** (`415`, `413`)
2. **Authentication** (`401`)
3. **Path Parameter, Header (`Idempotency-Key`), and Body Schema Validation** (`400`)
4. **Rate Limiting** (`429`)
5. **Idempotency Store Lookup** (`200` / cached `422` replay, `409` `idempotency-in-progress`, or `422` `idempotency-key-reused`)
6. **Role Check (`403` `forbidden-role`), Plan Lookup (`404` `plan-not-found`), and Ownership Check (`403` `ownership-violation`)**
7. **Plan Lifecycle State Check (`409` `plan-state-conflict`), Natural Idempotency Check (if already `saved`), and Optimistic Concurrency Check (`409` `revision-conflict`)**
8. **Deterministic Cost Calculation (`compute_cost`) & Backend Validation (`validate_plan`)** (`503` if validator data dependency is unavailable; `422` `plan-validation-failed` with **all** violations collected)
9. **Atomic Persist, Group Share Publish, Audit Log & Idempotency Commit** (`200 OK`)

---

## 4. Response Specification (Success)

### 4.1 Success Status Code & Headers

- **Status Code:** `200 OK` (returned on both the initial save and any idempotent replay).
- **Response Headers:**

| Header | Always Present | Format / Value |
|---|:---:|---|
| `Content-Type` | Yes | `application/json; charset=utf-8` |
| `Idempotency-Key` | Yes | Echoes the request's `Idempotency-Key` |
| `Idempotency-Replayed` | Yes | `"false"` on fresh execution; `"true"` when replayed from the idempotency store |
| `ETag` | Yes | Strong or weak revision tag formatted as `"rev-<revision>"` (e.g., `"rev-4"`) |
| `X-Request-Id` | Yes | Server-generated UUIDv4 correlation ID |
| `X-Contract-Version` | Yes | `"1.0.0"` |

### 4.2 Success Response Body Schema

#### Top-Level Object

| Field | Type | Nullable | Constraints & Semantics |
|---|---|:---:|---|
| `planId` | `string` | No | UUIDv4 of the saved plan. |
| `tripId` | `string` | No | UUIDv4 of the parent trip. |
| `groupId` | `string \| null` | Yes | UUIDv4 of the group when `budgetSummary.mode === "group"`; `null` for `"individual"` trips. |
| `status` | `string` | No | Always `"saved"`. |
| `revision` | `integer` | No | Positive integer (`>= 2` after first save from revision `1`). Incremented by `1` on the initial save; unchanged on idempotent replays. |
| `sharedWithGroup` | `boolean` | No | `true` if visible to all active members of `groupId`; `false` otherwise. |
| `sharedAt` | `string \| null` | Yes | RFC 3339 UTC timestamp (`...Z`) when shared with the group; `null` when `sharedWithGroup === false`. |
| `savedAt` | `string` | No | RFC 3339 UTC timestamp (`...Z`) when the plan transitioned to `"saved"`. |
| `savedByUserId` | `string` | No | UUIDv4 of the authenticated member who saved the plan. |
| `note` | `string \| null` | Yes | Trimmed share note, or `null` if none was provided. |
| `shareUrl` | `string \| null` | Yes | HTTPS URL for group members to view the shared plan when `sharedWithGroup === true`; `null` otherwise. |
| `validation` | `ValidationSummary` | No | Summary of the final backend validator execution. |
| `budgetSummary` | `BudgetSummary` | No | Server-authoritative cost summary produced by `compute_cost`. |
| `days` | `SavedDaySchedule[]` | No | Resolved day-by-day schedule with verified place metadata, travel times, weather snapshot, and server-computed pricing. |
| `attributions` | `string[]` | No | Required data source credits: always includes `"OpenStreetMap"`, `"Wikimedia"`, and `"Open-Meteo"`. |

#### `ValidationSummary` Object

| Field | Type | Nullable | Constraints & Semantics |
|---|---|:---:|---|
| `passed` | `boolean` | No | Always `true` on `200 OK`. |
| `validatedAt` | `string` | No | RFC 3339 UTC timestamp (`...Z`). |
| `validatorVersion` | `string` | No | Semantic version of the backend validator (e.g., `"1.0.0"`). |
| `checksRun` | `string[]` | No | Always `["existence", "opening_hours", "travel_time", "budget", "weather"]`. |

#### `BudgetSummary` Object & Deterministic VND Rounding Rule

| Field | Type | Nullable | Constraints & Semantics |
|---|---|:---:|---|
| `currency` | `string` | No | Always `"VND"`. |
| `mode` | `string` | No | `"individual"` or `"group"`. |
| `totalEstimatedVnd` | `integer` | No | Non-negative integer equal to the exact sum of all `days[*].dayTotalVnd` and the exact sum of `memberBreakdown[*].estimatedVnd`. |
| `groupBudgetLimitVnd` | `integer \| null` | Yes | Group total budget ceiling in VND (`null` in `"individual"` mode). Guaranteed `totalEstimatedVnd <= groupBudgetLimitVnd`. |
| `lowestMemberCapVnd` | `integer \| null` | Yes | Minimum `spendingCapVnd` across all active group members (`null` in `"individual"` mode). |
| `memberBreakdown` | `MemberBudget[]` | No | One entry per participant (1 entry in `"individual"` mode; all active group members in `"group"` mode), sorted ascending by `userId`. |

**`MemberBudget` Object:**

| Field | Type | Nullable | Constraints & Semantics |
|---|---|:---:|---|
| `userId` | `string` | No | Participant UUIDv4. |
| `estimatedVnd` | `integer` | No | Server-computed share for this member (`>= 0`). Guaranteed `<= spendingCapVnd` and, in `"group"` mode, `<= lowestMemberCapVnd`. |
| `spendingCapVnd` | `integer` | No | Member's personal spending cap (or individual trip budget) in VND (`> 0`). |
| `remainingVnd` | `integer` | No | `spendingCapVnd - estimatedVnd` (`>= 0`). |

> **Deterministic VND Split Rule:** For each stop ticket (`ticketPriceVnd`) and each menu line (`lineTotalVnd = unitPriceVnd * quantity`) shared across `k` participants (sorted ascending by `userId`), each participant receives `floor(amount / k)` VND, and the remainder `amount mod k` is distributed as `+1` VND to the first `amount mod k` participants in sorted `userId` order. Consequently, `sum(memberBreakdown[*].estimatedVnd) === totalEstimatedVnd` is guaranteed to the exact dong with zero floating-point arithmetic.

#### `SavedDaySchedule` & `SavedStop` Objects

| Field | Type | Nullable | Constraints & Semantics |
|---|---|:---:|---|
| `date` | `string` | No | `YYYY-MM-DD` (HCMC local date). |
| `dayTotalVnd` | `integer` | No | Exact sum of `stops[*].stopTotalVnd`. |
| `stops` | `SavedStop[]` | No | Ordered by ascending `startTime`. |

**`SavedStop` Object:**

| Field | Type | Nullable | Constraints & Semantics |
|---|---|:---:|---|
| `stopId` | `string` | No | UUIDv4 uniquely identifying the stop within the plan. |
| `placeId` | `string` | No | Checked place ID. |
| `placeName` | `string` | No | Verified place display name from the checked dataset. |
| `district` | `string` | No | Ho Chi Minh City district (e.g., `"District 1"`, `"District 3"`). |
| `isOutdoor` | `boolean` | No | `true` if outdoor venue (subject to the `> 60%` rain rule), `false` if indoor. |
| `startTime` | `string` | No | Local HCMC time `HH:MM`. |
| `endTime` | `string` | No | Local HCMC time `HH:MM`. |
| `openingHours` | `string` | No | Verified weekday opening window snapshot (e.g., `"06:00-22:00"`). |
| `travelMinutesFromPrevious` | `integer \| null` | Yes | Precomputed motorbike travel time in minutes from the previous stop on the same day (`null` for the first stop of each day). |
| `rainProbabilityPct` | `integer \| null` | Yes | Max hourly Open-Meteo rain probability (`0..100`) overlapping `[startTime, endTime]`, or `null` if `date` is beyond the 7-day forecast horizon. |
| `ticketPriceVnd` | `integer` | No | Verified per-person admission ticket price (`>= 0`). |
| `ticketSubtotalVnd` | `integer` | No | `ticketPriceVnd * participantCount`. |
| `menuSubtotalVnd` | `integer` | No | Exact sum of `selectedItems[*].lineTotalVnd`. |
| `stopTotalVnd` | `integer` | No | `ticketSubtotalVnd + menuSubtotalVnd`. |
| `selectedItems` | `SavedSelectedItem[]` | No | Array of resolved menu items (`menuItemId`, `itemName`, `unitPriceVnd`, `quantity`, `lineTotalVnd`, `assignedMemberIds`). |

---

## 5. Error Model — RFC 9457 Problem Details

Every `4xx` and `5xx` response from this endpoint MUST conform to **RFC 9457 (Problem Details for HTTP APIs)** and use:

- **HTTP Header:** `Content-Type: application/problem+json`
- **Problem Type Namespace:** `https://ai-travel-planner.local/problems/<slug>` (consistent with `apps/api/src/app.ts` and `packages/shared/src/problem-details.ts`).

### 5.1 Standard Envelope Members

Every error response JSON object MUST contain:

| Member | Type | Required | Semantics |
|---|---|:---:|---|
| `type` | `string` (URI) | Yes | Stable machine-readable problem identifier. **Clients MUST branch logic on `type`, never on `title` or `detail`.** |
| `title` | `string` | Yes | Short, human-readable summary invariant for a given `type`. |
| `status` | `integer` | Yes | Exact HTTP status code (`400`–`599`). |
| `detail` | `string` | Yes | Occurrence-specific explanation safe to display or log. Never leaks stack traces, SQL, secrets, or another user's PII. |
| `instance` | `string` | Yes | Request path identifying the occurrence (e.g., `/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save`). |
| `requestId` | `string` | Yes | Extension member (UUIDv4) matching the `X-Request-Id` response header for support and audit correlation. |

### 5.2 Complete Error Catalog

| HTTP Status | Problem `type` URI | `title` | Extension Members | Retryable? |
|:---:|---|---|---|---|
| `400` | `https://ai-travel-planner.local/problems/invalid-request` | `Invalid Request` | `errors: FieldError[]` | No (fix request) |
| `400` | `https://ai-travel-planner.local/problems/invalid-idempotency-key` | `Invalid Idempotency Key` | — | No (send valid key) |
| `401` | `https://ai-travel-planner.local/problems/unauthorized` | `Unauthorized` | — | After re-auth |
| `403` | `https://ai-travel-planner.local/problems/forbidden-role` | `Forbidden Role` | `requiredRole` | No |
| `403` | `https://ai-travel-planner.local/problems/ownership-violation` | `Ownership Violation` | — | No |
| `404` | `https://ai-travel-planner.local/problems/plan-not-found` | `Plan Not Found` | `planId` | No |
| `409` | `https://ai-travel-planner.local/problems/plan-state-conflict` | `Plan State Conflict` | `currentStatus`, `allowedStatuses` | No (unless regenerating finishes) |
| `409` | `https://ai-travel-planner.local/problems/revision-conflict` | `Revision Conflict` | `expectedRevision`, `currentRevision` | After re-fetching plan |
| `409` | `https://ai-travel-planner.local/problems/idempotency-in-progress` | `Request In Progress` | `retryAfterSeconds` (+ `Retry-After` header) | **Yes** (same key) |
| `413` | `https://ai-travel-planner.local/problems/payload-too-large` | `Payload Too Large` | `maxBytes` | No |
| `415` | `https://ai-travel-planner.local/problems/unsupported-media-type` | `Unsupported Media Type` | `acceptedMediaTypes` | No |
| `422` | `https://ai-travel-planner.local/problems/idempotency-key-reused` | `Idempotency Key Reused With Different Payload` | `idempotencyKey` | No (mint new key) |
| `422` | `https://ai-travel-planner.local/problems/plan-validation-failed` | `Plan Validation Failed` | `validatorVersion`, `violations: PlanViolation[]` | No (fix violations + new key) |
| `429` | `https://ai-travel-planner.local/problems/rate-limited` | `Too Many Requests` | `retryAfterSeconds` (+ `Retry-After` header) | **Yes** (same key, after delay) |
| `500` | `https://ai-travel-planner.local/problems/internal-error` | `Internal Server Error` | — | **Yes** (same key, backoff) |
| `503` | `https://ai-travel-planner.local/problems/validator-dependency-unavailable` | `Validator Dependency Unavailable` | `dependency`, `retryAfterSeconds` (+ `Retry-After` header) | **Yes** (same key, backoff) |

> **Fail-Closed Guarantee (`503`):** If the backend cannot read the checked place dataset, motorbike travel-time matrix, or 7-day Open-Meteo weather forecast needed to run `validate_plan`, it MUST fail closed with `503` (`validator-dependency-unavailable`). It MUST NEVER bypass validation or save an unverified plan.

### 5.3 Backend Validator Violation Codes (`plan-validation-failed`)

When `validate_plan` rejects a plan, the server runs **all** five checks and returns every violation in `violations[]` (never stopping at the first violation), so the client can highlight every problem at once.

Each element of `violations[]` (`PlanViolation`) has:

| Field | Type | Nullable | Description |
|---|---|:---:|---|
| `code` | `string` | No | One of the normative violation codes below. |
| `dayDate` | `string \| null` | Yes | `YYYY-MM-DD` of the offending stop, or `null` for trip-wide budget violations. |
| `stopId` | `string \| null` | Yes | Offending stop UUIDv4 (or client index label if unassigned), or `null` for trip-wide violations. |
| `placeId` | `string \| null` | Yes | Offending `placeId`, or `null` for trip-wide violations. |
| `message` | `string` | No | Human-readable explanation suitable for rendering next to the stop or budget bar. |
| `details` | `object` | No | Machine-readable structured context specific to `code` (see table below). |

| Violation `code` | Rule Violated | `details` Object Fields |
|---|---|---|
| `PLACE_NOT_FOUND` | Place does not exist in the checked dataset, or is missing verified opening hours/menu data. | `{ "placeId": string, "reason": "unknown_place" \| "missing_hours" \| "missing_menu" }` |
| `MENU_ITEM_NOT_FOUND` | Selected menu item does not exist or does not belong to `placeId`. | `{ "placeId": string, "menuItemId": string }` |
| `OUTSIDE_OPENING_HOURS` | Stop `[startTime, endTime]` falls outside the place's checked opening hours for that weekday or occurs on a closed public holiday. | `{ "requestedStart": "HH:MM", "requestedEnd": "HH:MM", "openingHours": "HH:MM-HH:MM" \| "CLOSED", "weekday": string }` |
| `TRAVEL_TIME_EXCEEDED` | Precomputed motorbike travel time between consecutive stops exceeds the scheduled gap (or stops overlap). | `{ "fromPlaceId": string, "toPlaceId": string, "requiredTravelMinutes": integer, "availableGapMinutes": integer }` |
| `BUDGET_EXCEEDED` | Total group cost exceeds `groupBudgetLimitVnd`, a member's spending exceeds their own `spendingCapVnd`, or per-person spending exceeds `lowestMemberCapVnd`. | `{ "scope": "individual" \| "member_cap" \| "lowest_group_cap" \| "group_total", "userId": string \| null, "estimatedVnd": integer, "limitVnd": integer, "excessVnd": integer }` |
| `RAIN_RISK_OUTDOOR` | An outdoor stop (`isOutdoor: true`) is scheduled during an hour within the 7-day forecast whose rain probability is strictly greater than `60%`. | `{ "rainProbabilityPct": integer, "thresholdPct": 60, "forecastHour": "HH:00" }` |

### 5.4 Error Payload Examples (All Error Types)

#### `400` — `invalid-request`

```json
{
  "type": "https://ai-travel-planner.local/problems/invalid-request",
  "title": "Invalid Request",
  "status": 400,
  "detail": "Request body failed schema validation.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "c1f3e2d4-5b6a-4789-9abc-def012345678",
  "errors": [
    {
      "pointer": "/expectedRevision",
      "code": "invalid_type",
      "message": "expectedRevision must be an integer >= 1."
    },
    {
      "pointer": "/edits/days/0/stops/0/endTime",
      "code": "invalid_range",
      "message": "endTime must be at least 15 minutes after startTime."
    }
  ]
}
```

#### `400` — `invalid-idempotency-key`

```json
{
  "type": "https://ai-travel-planner.local/problems/invalid-idempotency-key",
  "title": "Invalid Idempotency Key",
  "status": 400,
  "detail": "Header 'Idempotency-Key' is required and must match ^[A-Za-z0-9._-]{16,128}$.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "e4d5c6b7-1a2b-4c3d-8e4f-5a6b7c8d9e0f"
}
```

#### `401` — `unauthorized`

```json
{
  "type": "https://ai-travel-planner.local/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Missing or expired Bearer access token.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "0a1b2c3d-4e5f-4678-9abc-def123456789"
}
```

#### `403` — `forbidden-role`

```json
{
  "type": "https://ai-travel-planner.local/problems/forbidden-role",
  "title": "Forbidden Role",
  "status": 403,
  "detail": "Accounts with role 'business' are not permitted to save travel plans.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "11223344-5566-4777-8888-99990000aaaa",
  "requiredRole": "member"
}
```

#### `403` — `ownership-violation`

```json
{
  "type": "https://ai-travel-planner.local/problems/ownership-violation",
  "title": "Ownership Violation",
  "status": 403,
  "detail": "You do not own this plan draft or are not an active member of its trip group.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "22334455-6677-4888-9999-00001111bbbb"
}
```

#### `404` — `plan-not-found`

```json
{
  "type": "https://ai-travel-planner.local/problems/plan-not-found",
  "title": "Plan Not Found",
  "status": 404,
  "detail": "No plan exists with id '9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d'.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "33445566-7788-4999-aaaa-11112222cccc",
  "planId": "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d"
}
```

#### `409` — `plan-state-conflict`

```json
{
  "type": "https://ai-travel-planner.local/problems/plan-state-conflict",
  "title": "Plan State Conflict",
  "status": 409,
  "detail": "Plan is currently in status 'generating' and cannot be saved until draft generation finishes.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "44556677-8899-4aaa-bbbb-22223333dddd",
  "currentStatus": "generating",
  "allowedStatuses": ["draft"]
}
```

#### `409` — `revision-conflict`

```json
{
  "type": "https://ai-travel-planner.local/problems/revision-conflict",
  "title": "Revision Conflict",
  "status": 409,
  "detail": "Expected revision 2 does not match current plan revision 3. Reload the latest plan before saving.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "55667788-99aa-4bbb-cccc-33334444eeee",
  "expectedRevision": 2,
  "currentRevision": 3
}
```

#### `409` — `idempotency-in-progress`

```json
{
  "type": "https://ai-travel-planner.local/problems/idempotency-in-progress",
  "title": "Request In Progress",
  "status": 409,
  "detail": "Another save request with the same Idempotency-Key is currently processing. Retry shortly with the same key.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "66778899-aabb-4ccc-dddd-44445555ffff",
  "retryAfterSeconds": 1
}
```

#### `413` — `payload-too-large`

```json
{
  "type": "https://ai-travel-planner.local/problems/payload-too-large",
  "title": "Payload Too Large",
  "status": 413,
  "detail": "Request payload exceeds the maximum allowed size of 65536 bytes.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "778899aa-bbcc-4ddd-eeee-555566660000",
  "maxBytes": 65536
}
```

#### `415` — `unsupported-media-type`

```json
{
  "type": "https://ai-travel-planner.local/problems/unsupported-media-type",
  "title": "Unsupported Media Type",
  "status": 415,
  "detail": "Content-Type must be 'application/json'.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "8899aabb-ccdd-4eee-ffff-666677771111",
  "acceptedMediaTypes": ["application/json"]
}
```

#### `422` — `idempotency-key-reused`

```json
{
  "type": "https://ai-travel-planner.local/problems/idempotency-key-reused",
  "title": "Idempotency Key Reused With Different Payload",
  "status": 422,
  "detail": "Idempotency-Key '7f9e8d7c-6b5a-4432-9100-abcdef123456' was already used with a different request payload.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "99aabbcc-ddee-4fff-8000-777788882222",
  "idempotencyKey": "7f9e8d7c-6b5a-4432-9100-abcdef123456"
}
```

#### `422` — `plan-validation-failed`

```json
{
  "type": "https://ai-travel-planner.local/problems/plan-validation-failed",
  "title": "Plan Validation Failed",
  "status": 422,
  "detail": "Backend validator found 4 blocking violation(s). The plan was not saved or shared with the group.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "aabbccdd-eeff-4000-8111-888899993333",
  "validatorVersion": "1.0.0",
  "violations": [
    {
      "code": "OUTSIDE_OPENING_HOURS",
      "dayDate": "2026-11-28",
      "stopId": "f1000001-0000-4000-8000-000000000001",
      "placeId": "plc_hcmc_003",
      "message": "Dinh Độc Lập closes at 16:30 on Saturday; stop ends at 17:15.",
      "details": {
        "requestedStart": "15:30",
        "requestedEnd": "17:15",
        "openingHours": "08:00-16:30",
        "weekday": "saturday"
      }
    },
    {
      "code": "TRAVEL_TIME_EXCEEDED",
      "dayDate": "2026-11-28",
      "stopId": "f1000001-0000-4000-8000-000000000002",
      "placeId": "plc_hcmc_088",
      "message": "Motorbike travel from plc_hcmc_003 to plc_hcmc_088 requires 28 minutes, but only 10 minutes are available.",
      "details": {
        "fromPlaceId": "plc_hcmc_003",
        "toPlaceId": "plc_hcmc_088",
        "requiredTravelMinutes": 28,
        "availableGapMinutes": 10
      }
    },
    {
      "code": "RAIN_RISK_OUTDOOR",
      "dayDate": "2026-11-28",
      "stopId": "f1000001-0000-4000-8000-000000000002",
      "placeId": "plc_hcmc_088",
      "message": "Outdoor stop Công Viên Bến Bạch Đằng is scheduled during a 75% chance of rain (threshold: 60%).",
      "details": {
        "rainProbabilityPct": 75,
        "thresholdPct": 60,
        "forecastHour": "17:00"
      }
    },
    {
      "code": "BUDGET_EXCEEDED",
      "dayDate": null,
      "stopId": null,
      "placeId": null,
      "message": "Estimated per-person spending of 920,000 VND exceeds member An's personal cap of 800,000 VND by 120,000 VND.",
      "details": {
        "scope": "lowest_group_cap",
        "userId": "33333333-3333-4333-8333-333333333333",
        "estimatedVnd": 920000,
        "limitVnd": 800000,
        "excessVnd": 120000
      }
    }
  ]
}
```

#### `429` — `rate-limited`

```json
{
  "type": "https://ai-travel-planner.local/problems/rate-limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Save rate limit exceeded. Wait 15 seconds before retrying.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "bbccddee-ff00-4111-8222-9999aaaa4444",
  "retryAfterSeconds": 15
}
```

#### `500` — `internal-error`

```json
{
  "type": "https://ai-travel-planner.local/problems/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred while processing the request.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "ccddeeff-0011-4222-8333-aaaabbbb5555"
}
```

#### `503` — `validator-dependency-unavailable`

```json
{
  "type": "https://ai-travel-planner.local/problems/validator-dependency-unavailable",
  "title": "Validator Dependency Unavailable",
  "status": 503,
  "detail": "Unable to verify 7-day weather forecast from Open-Meteo. Save aborted to prevent sharing an unvalidated schedule.",
  "instance": "/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save",
  "requestId": "ddeeff00-1122-4333-8444-bbbbcccc6666",
  "dependency": "open-meteo-forecast",
  "retryAfterSeconds": 5
}
```

---

## 6. Idempotency & Concurrency Semantics

Because saving shares the itinerary with the entire group and triggers group notifications, repeating `POST /plans/{planId}/save` (double-click, flaky mobile network, or automatic retry) **MUST NEVER** create duplicate saved schedules, bump `revision` more than once, or send duplicate notifications.

### 6.1 `Idempotency-Key` Specification

- **Requirement:** Mandatory header on every request (`^[A-Za-z0-9._-]{16,128}$`). Clients SHOULD generate a fresh UUIDv4 per user Save click and reuse that exact key across retries of the same click.
- **Scope:** Partitioned by `(caller.userId, "POST", "/plans/{planId}/save", Idempotency-Key)`. Keys from different users or different `planId`s never collide.
- **Request Fingerprinting:** The server computes a canonical SHA-256 hash of the parsed JSON body (recursively sorted object keys, no insignificant whitespace).
- **Retention Window (TTL):** Stored completed records are retained for **24 hours** from completion.

### 6.2 Idempotency Outcome Matrix

| Case | Condition | HTTP Status | `Idempotency-Replayed` | Side Effects |
|---|---|---|:---:|---|
| **First execution** | Key not seen in scope | `200` (or `422`/`4xx`/`5xx`) | `false` | Runs full pipeline; caches `200` and deterministic `422` (`plan-validation-failed`). |
| **Safe retry (same key + same payload)** | Key completed with identical canonical body hash | Original cached status (`200` or `422`) | `true` | **None.** Exact stored response body is replayed; no duplicate share or revision bump; `expectedRevision` is NOT re-checked. |
| **Concurrent in-flight duplicate** | Key currently executing in another request | `409` (`idempotency-in-progress`) | `false` | **None.** Client retries with the **same** key after `Retry-After`. |
| **Key reuse with altered payload** | Key exists in scope, but canonical body hash differs | `422` (`idempotency-key-reused`) | `false` | **None.** Original stored record remains intact. |
| **Transient failure retry** | First attempt returned `429`, `500`, or `503` (or pre-idempotency `400`/`401`/`413`/`415`) | Fresh execution | `false` | Transient failures are **never cached**; lock is released so retrying with the same key executes normally. |

### 6.3 Natural State Idempotency (Lost Key After Save)

If a client crashes or reloads after the server already transitioned the plan to `status: "saved"` and then sends `POST /plans/{planId}/save` with a **new** `Idempotency-Key`:

- If `edits` is **omitted**, `expectedRevision === plan.revision`, `shareWithGroup` matches `plan.sharedWithGroup` (or is omitted), and `note` matches `plan.note` (or is omitted):
  - The server returns **`200 OK`** (`Idempotency-Replayed: false`) with the already-saved plan representation, **without** incrementing `revision` and **without** re-notifying the group.
- If `edits` is provided or `shareWithGroup` differs on an already-saved plan:
  - The server returns **`409 Conflict`** (`plan-state-conflict`), because post-save modifications require a separate revision/edit flow rather than mutating an already-published snapshot through `save`.
- If `expectedRevision !== plan.revision` (with a **new** `Idempotency-Key`):
  - The server returns **`409 Conflict`** (`revision-conflict`) so stale clients reload the saved state.

### 6.4 Client Retry Guidance

- **Safe to retry automatically (reuse the exact same `Idempotency-Key`):** network errors/timeouts, `409` (`idempotency-in-progress`), `429`, `500`, `503`. Use capped exponential backoff with jitter (`1s`, `2s`, `4s`, max 3 retries), honoring `Retry-After` when present.
- **Do NOT blindly retry:** `400`, `401` (refresh token first), `403`, `404`, `409` (`plan-state-conflict`, `revision-conflict`), `413`, `415`, `422`. After fixing a `422` (`plan-validation-failed`), the client MUST generate a **new** `Idempotency-Key`.

---

## 7. What Happens When It Changes (Compatibility & Versioning Policy)

### 7.1 Versioning Strategy

- This contract defines **major version `v1`** (`X-Contract-Version: 1.0.0`), mounted at `POST /plans/{planId}/save`.
- Minor and patch revisions (`1.x.y`) are strictly backward-compatible and stay on the same route.
- Any breaking change MUST be published on a new major path prefix (`POST /v2/plans/{planId}/save`) rather than modifying `v1` in place.

### 7.2 Backward-Compatible (Non-Breaking) Changes Allowed in `v1`

The server MAY make the following changes without bumping the major version:

- Add new **optional** fields to the request body.
- Add new fields to the `200 OK` response body or new extension members to RFC 9457 Problem Details objects.
- Add new validator violation `code` values inside `422` (`plan-validation-failed`) when new safety checks are introduced.
- Add new RFC 9457 problem `type` URIs for newly introduced error conditions.
- Relax an existing request constraint (for example, increasing `note` max length from `280` to `500`).

### 7.3 Breaking Changes Forbidden in `v1` (Require `v2`)

The following changes are **breaking** and MUST NOT be shipped to `v1`:

- Removing or renaming any existing request or response field.
- Changing any field's data type, unit (`VND`, minutes, `HH:MM`), or nullability (changing a non-null field to nullable).
- Making an optional request field required, or removing an allowed enum value.
- Changing the HTTP status code or RFC 9457 `type` URI for an existing documented failure condition.
- Weakening or altering ownership rules or idempotency guarantees in a way that breaks compliant clients.

### 7.4 Client Compatibility Rules (Tolerant Reader)

To remain compatible across all `1.x.y` server releases, clients MUST:

1. Ignore unknown fields in `200 OK` responses and `application/problem+json` payloads.
2. Dispatch error handling by matching exact RFC 9457 `type` URIs, with a generic fallback using `status`, `title`, and `detail` for unrecognized `type` values.
3. Treat any unrecognized `violations[].code` inside `plan-validation-failed` as a blocking validation error and display `violations[].message` to the user.

### 7.5 Deprecation, Sunset & Repository Governance

- **Deprecation Window:** When `v2` is introduced, `v1` remains supported for at least **90 days** in production (or at least **one full course checkpoint milestone** during class development).
- **Deprecation Headers:** Deprecated `v1` responses emit RFC 8594 `Deprecation` and `Sunset` headers alongside `Link: </v2/plans/{planId}/save>; rel="successor-version"`.
- **Contract-First Rule in This Repository:** Any change to this endpoint MUST update `docs/contract/post-plans-save.md` (and its Changelog below) **first**, followed by corresponding updates to the contract test suite and implementation. Tests MUST NEVER be edited silently to hide a contract regression.

---

## 8. Complete Wire Examples & Client Checklist

### 8.1 Happy Path — Group Weekend Save (`200 OK`)

**Request:**

```http
POST /plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d/save HTTP/1.1
Host: api.ai-travel-planner.local
Authorization: Bearer eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.<payload>.<sig>
Content-Type: application/json
Accept: application/json, application/problem+json
Idempotency-Key: 7f9e8d7c-6b5a-4432-9100-abcdef123456

{
  "expectedRevision": 3,
  "shareWithGroup": true,
  "note": "Swapped Saturday afternoon stop to an indoor cafe because of rain forecast."
}
```

**Response (`200 OK`, first execution):**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Idempotency-Key: 7f9e8d7c-6b5a-4432-9100-abcdef123456
Idempotency-Replayed: false
ETag: "rev-4"
X-Request-Id: 0f1e2d3c-4b5a-4678-9abc-0123456789ab
X-Contract-Version: 1.0.0

{
  "planId": "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d",
  "tripId": "550e8400-e29b-41d4-a716-446655440000",
  "groupId": "770e8400-e29b-41d4-a716-446655440099",
  "status": "saved",
  "revision": 4,
  "sharedWithGroup": true,
  "sharedAt": "2026-11-26T10:15:30Z",
  "savedAt": "2026-11-26T10:15:30Z",
  "savedByUserId": "11111111-1111-4111-8111-111111111111",
  "note": "Swapped Saturday afternoon stop to an indoor cafe because of rain forecast.",
  "shareUrl": "https://ai-travel-planner.local/groups/770e8400-e29b-41d4-a716-446655440099/plans/9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d",
  "validation": {
    "passed": true,
    "validatedAt": "2026-11-26T10:15:29Z",
    "validatorVersion": "1.0.0",
    "checksRun": [
      "existence",
      "opening_hours",
      "travel_time",
      "budget",
      "weather"
    ]
  },
  "budgetSummary": {
    "currency": "VND",
    "mode": "group",
    "totalEstimatedVnd": 720000,
    "groupBudgetLimitVnd": 3600000,
    "lowestMemberCapVnd": 800000,
    "memberBreakdown": [
      {
        "userId": "11111111-1111-4111-8111-111111111111",
        "estimatedVnd": 180000,
        "spendingCapVnd": 1000000,
        "remainingVnd": 820000
      },
      {
        "userId": "22222222-2222-4222-8222-222222222222",
        "estimatedVnd": 180000,
        "spendingCapVnd": 1000000,
        "remainingVnd": 820000
      },
      {
        "userId": "33333333-3333-4333-8333-333333333333",
        "estimatedVnd": 180000,
        "spendingCapVnd": 800000,
        "remainingVnd": 620000
      },
      {
        "userId": "44444444-4444-4444-8444-444444444444",
        "estimatedVnd": 180000,
        "spendingCapVnd": 1000000,
        "remainingVnd": 820000
      }
    ]
  },
  "days": [
    {
      "date": "2026-11-28",
      "dayTotalVnd": 720000,
      "stops": [
        {
          "stopId": "a1000001-0000-4000-8000-000000000001",
          "placeId": "plc_hcmc_014",
          "placeName": "Phở Hòa Pasteur",
          "district": "District 3",
          "isOutdoor": false,
          "startTime": "08:30",
          "endTime": "09:30",
          "openingHours": "06:00-22:00",
          "travelMinutesFromPrevious": null,
          "rainProbabilityPct": 15,
          "ticketPriceVnd": 0,
          "ticketSubtotalVnd": 0,
          "menuSubtotalVnd": 420000,
          "stopTotalVnd": 420000,
          "selectedItems": [
            {
              "menuItemId": "itm_phohoa_01",
              "itemName": "Phở tái nạm",
              "unitPriceVnd": 95000,
              "quantity": 4,
              "lineTotalVnd": 380000,
              "assignedMemberIds": [
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333",
                "44444444-4444-4444-8444-444444444444"
              ]
            },
            {
              "menuItemId": "itm_phohoa_04",
              "itemName": "Trà đá",
              "unitPriceVnd": 10000,
              "quantity": 4,
              "lineTotalVnd": 40000,
              "assignedMemberIds": [
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333",
                "44444444-4444-4444-8444-444444444444"
              ]
            }
          ]
        },
        {
          "stopId": "a1000001-0000-4000-8000-000000000002",
          "placeId": "plc_hcmc_003",
          "placeName": "Dinh Độc Lập",
          "district": "District 1",
          "isOutdoor": false,
          "startTime": "09:50",
          "endTime": "11:30",
          "openingHours": "08:00-16:30",
          "travelMinutesFromPrevious": 12,
          "rainProbabilityPct": 20,
          "ticketPriceVnd": 40000,
          "ticketSubtotalVnd": 160000,
          "menuSubtotalVnd": 0,
          "stopTotalVnd": 160000,
          "selectedItems": []
        },
        {
          "stopId": "a1000001-0000-4000-8000-000000000003",
          "placeId": "plc_hcmc_042",
          "placeName": "Cà Phê Vợt Cheo Leo",
          "district": "District 3",
          "isOutdoor": false,
          "startTime": "13:30",
          "endTime": "15:00",
          "openingHours": "05:30-18:30",
          "travelMinutesFromPrevious": 15,
          "rainProbabilityPct": 72,
          "ticketPriceVnd": 0,
          "ticketSubtotalVnd": 0,
          "menuSubtotalVnd": 140000,
          "stopTotalVnd": 140000,
          "selectedItems": [
            {
              "menuItemId": "itm_cheoleo_01",
              "itemName": "Cà phê sữa đá",
              "unitPriceVnd": 35000,
              "quantity": 4,
              "lineTotalVnd": 140000,
              "assignedMemberIds": [
                "11111111-1111-4111-8111-111111111111",
                "22222222-2222-4222-8222-222222222222",
                "33333333-3333-4333-8333-333333333333",
                "44444444-4444-4444-8444-444444444444"
              ]
            }
          ]
        }
      ]
    }
  ],
  "attributions": [
    "OpenStreetMap",
    "Wikimedia",
    "Open-Meteo"
  ]
}
```

### 8.2 Idempotent Retry (`200 OK`, Replayed)

Re-sending the exact HTTP request from Section 8.1 with the same `Idempotency-Key: 7f9e8d7c-6b5a-4432-9100-abcdef123456` within 24 hours returns the identical `200 OK` JSON body (`revision: 4`, `savedAt: "2026-11-26T10:15:30Z"`) with header:

```http
Idempotency-Replayed: true
```

No duplicate group share or revision increment occurs.

### 8.3 Client Implementation Checklist

A developer implementing a client from this file alone should:

1. Attach `Authorization: Bearer <token>`, `Content-Type: application/json`, and a freshly minted UUIDv4 `Idempotency-Key` per user Save action.
2. Pass the draft's current `revision` as `expectedRevision` (and include `edits` only when the user modified stops/items in Step 6). Never send client-calculated prices or totals.
3. On `200 OK`, render the server-authoritative `budgetSummary`, `days`, `shareUrl`, and `attributions` (`OpenStreetMap`, `Wikimedia`, `Open-Meteo`), and store the new `revision`.
4. On any non-2xx response with `Content-Type: application/problem+json`, inspect `type` (not `title`/`detail`):
   - `plan-validation-failed` (`422`): highlight each entry in `violations[]` by `stopId`/`dayDate` and display `message`; mint a new `Idempotency-Key` after the user fixes the schedule.
   - `revision-conflict` (`409`): reload the latest draft and ask the user to review before re-saving.
   - `idempotency-in-progress` (`409`), `rate-limited` (`429`), `internal-error` (`500`), `validator-dependency-unavailable` (`503`): retry with exponential backoff + jitter reusing the **same** `Idempotency-Key`.
   - `ownership-violation` / `forbidden-role` (`403`) or `plan-not-found` (`404`): stop retrying and surface a clear access/not-found message.
5. Ignore unknown response fields and unknown `violations[].code` values gracefully per Section 7.4.

---

## Changelog

| Version | Date | Summary |
|---|---|---|
| `1.0.0` | `2026-11-25` | Initial normative contract for `POST /plans/{planId}/save` (RFC 9457 Problem Details, role + ownership rules, 5-rule backend validator gate, dual-layer idempotency, versioning policy). |
