import { PROBLEM_CONTENT_TYPE, ProblemDetailsSchema } from "@ai-travel-planner/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createSignedJwt } from "../../src/plans-save/auth.js";
import { UUID_V4_REGEX } from "../../src/plans-save/schema.js";
import { FIXTURE_IDS, createDefaultPlansSaveStore } from "../../src/plans-save/store.js";
import type {
  PlansSaveRuntimeOptions,
  SavedPlanResponse,
  UserRole,
  ValidatorDependencyName,
} from "../../src/plans-save/types.js";
import {
  ATTRIBUTIONS,
  CHECKS_RUN,
  CONTRACT_VERSION,
  PROBLEM_TYPES,
} from "../../src/plans-save/types.js";

const FIXED_NOW = new Date("2026-11-26T10:15:30Z");
const VALID_EXP = Math.floor(FIXED_NOW.getTime() / 1000) + 3600;
const EXPIRED_EXP = Math.floor(FIXED_NOW.getTime() / 1000) - 60;

const GROUP_PLAN_URL = `/plans/${FIXTURE_IDS.plans.groupDraft}/save`;
const INDIVIDUAL_PLAN_URL = `/plans/${FIXTURE_IDS.plans.individualDraft}/save`;
const GENERATING_PLAN_URL = `/plans/${FIXTURE_IDS.plans.generatingDraft}/save`;
const REMOVED_CREATOR_PLAN_URL = `/plans/${FIXTURE_IDS.plans.removedCreatorDraft}/save`;
const UNKNOWN_PLAN_URL = `/plans/${FIXTURE_IDS.plans.unknownPlan}/save`;

const IDEM_KEY_1 = "7f9e8d7c-6b5a-4432-9100-abcdef123456";
const IDEM_KEY_2 = "8a1b2c3d-4e5f-4678-9abc-fedcba654321";

function bearerHeader(
  userId: string = FIXTURE_IDS.users.creator,
  role: UserRole = "member",
  overrides: { exp?: number; jti?: string; signingKey?: string } = {},
): string {
  const jwt = createSignedJwt(
    {
      sub: userId,
      role,
      exp: overrides.exp ?? VALID_EXP,
      ...(overrides.jti !== undefined ? { jti: overrides.jti } : {}),
    },
    overrides.signingKey,
  );
  return `Bearer ${jwt}`;
}

function assertProblemDetails(
  response: {
    statusCode: number;
    headers: Record<string, string | number | string[] | undefined>;
    json: () => unknown;
  },
  expected: {
    status: number;
    type: string;
    title: string;
    instance: string;
  },
): Record<string, unknown> {
  expect(response.statusCode).toBe(expected.status);
  expect(String(response.headers["content-type"])).toContain(PROBLEM_CONTENT_TYPE);

  const body = response.json() as Record<string, unknown>;
  const parsed = ProblemDetailsSchema.safeParse(body);
  expect(parsed.success).toBe(true);
  expect(body.type).toBe(expected.type);
  expect(body.title).toBe(expected.title);
  expect(body.status).toBe(expected.status);
  expect(typeof body.detail).toBe("string");
  expect((body.detail as string).length).toBeGreaterThan(0);
  expect(body.instance).toBe(expected.instance);
  expect(typeof body.requestId).toBe("string");
  expect(UUID_V4_REGEX.test(body.requestId as string)).toBe(true);
  expect(response.headers["x-request-id"]).toBe(body.requestId);
  return body;
}

describe("Contract Tests: POST /plans/{planId}/save (v1.0.0)", () => {
  const appsToClose: FastifyInstance[] = [];

  function createTestHarness(options: PlansSaveRuntimeOptions = {}) {
    const store = options.store ?? createDefaultPlansSaveStore();
    const app = buildApp({
      logger: false,
      plansSave: {
        store,
        now: () => FIXED_NOW,
        ...options,
      },
    });
    appsToClose.push(app);
    return { app, store };
  }

  afterEach(async () => {
    while (appsToClose.length > 0) {
      const app = appsToClose.pop();
      if (app) {
        await app.close();
      }
    }
  });

  describe("1. Happy Path & Response Schema", () => {
    it("saves and shares a valid group draft with exact RFC-compliant response and headers", async () => {
      const { app, store } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 3,
          shareWithGroup: true,
          note: "  Swapped Saturday afternoon stop to an indoor cafe because of rain forecast.  ",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["idempotency-key"]).toBe(IDEM_KEY_1);
      expect(response.headers["idempotency-replayed"]).toBe("false");
      expect(response.headers.etag).toBe('"rev-4"');
      expect(response.headers["x-contract-version"]).toBe(CONTRACT_VERSION);
      expect(UUID_V4_REGEX.test(String(response.headers["x-request-id"]))).toBe(true);

      const body = response.json() as SavedPlanResponse;
      expect(body.planId).toBe(FIXTURE_IDS.plans.groupDraft);
      expect(body.tripId).toBe(FIXTURE_IDS.trips.groupTrip);
      expect(body.groupId).toBe(FIXTURE_IDS.groups.weekendGroup);
      expect(body.status).toBe("saved");
      expect(body.revision).toBe(4);
      expect(body.sharedWithGroup).toBe(true);
      expect(body.sharedAt).toBe("2026-11-26T10:15:30Z");
      expect(body.savedAt).toBe("2026-11-26T10:15:30Z");
      expect(body.savedByUserId).toBe(FIXTURE_IDS.users.creator);
      expect(body.note).toBe(
        "Swapped Saturday afternoon stop to an indoor cafe because of rain forecast.",
      );
      expect(body.shareUrl).toBe(
        `https://ai-travel-planner.local/groups/${FIXTURE_IDS.groups.weekendGroup}/plans/${FIXTURE_IDS.plans.groupDraft}`,
      );
      expect(body.validation).toEqual({
        passed: true,
        validatedAt: "2026-11-26T10:15:30Z",
        validatorVersion: "1.0.0",
        checksRun: [...CHECKS_RUN],
      });
      expect(body.attributions).toEqual([...ATTRIBUTIONS]);

      // Exact server-computed budget matching Section 8.1
      expect(body.budgetSummary.currency).toBe("VND");
      expect(body.budgetSummary.mode).toBe("group");
      expect(body.budgetSummary.totalEstimatedVnd).toBe(720_000);
      expect(body.budgetSummary.groupBudgetLimitVnd).toBe(3_600_000);
      expect(body.budgetSummary.lowestMemberCapVnd).toBe(800_000);
      expect(body.budgetSummary.memberBreakdown).toEqual([
        {
          userId: FIXTURE_IDS.users.creator,
          estimatedVnd: 180_000,
          spendingCapVnd: 1_000_000,
          remainingVnd: 820_000,
        },
        {
          userId: FIXTURE_IDS.users.activePeer,
          estimatedVnd: 180_000,
          spendingCapVnd: 1_000_000,
          remainingVnd: 820_000,
        },
        {
          userId: FIXTURE_IDS.users.lowestCapMember,
          estimatedVnd: 180_000,
          spendingCapVnd: 800_000,
          remainingVnd: 620_000,
        },
        {
          userId: FIXTURE_IDS.users.fourthMember,
          estimatedVnd: 180_000,
          spendingCapVnd: 1_000_000,
          remainingVnd: 820_000,
        },
      ]);

      expect(body.days).toHaveLength(1);
      expect(body.days[0]?.dayTotalVnd).toBe(720_000);
      // Indoor cafe at 72% rain is allowed (rule only rejects outdoor stops > 60%)
      expect(body.days[0]?.stops[2]?.isOutdoor).toBe(false);
      expect(body.days[0]?.stops[2]?.rainProbabilityPct).toBe(72);
      expect(store.sharedEvents).toHaveLength(1);
    });

    it("saves an individual draft without group sharing and normalizes whitespace-only note to null", async () => {
      const { app, store } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: INDIVIDUAL_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json; charset=utf-8",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 1,
          note: "   \n  ",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as SavedPlanResponse;
      expect(body.groupId).toBeNull();
      expect(body.sharedWithGroup).toBe(false);
      expect(body.sharedAt).toBeNull();
      expect(body.shareUrl).toBeNull();
      expect(body.note).toBeNull();
      expect(body.revision).toBe(2);
      expect(body.budgetSummary.mode).toBe("individual");
      expect(body.budgetSummary.groupBudgetLimitVnd).toBeNull();
      expect(body.budgetSummary.lowestMemberCapVnd).toBeNull();
      expect(body.budgetSummary.totalEstimatedVnd).toBe(145_000);
      expect(body.budgetSummary.memberBreakdown).toEqual([
        {
          userId: FIXTURE_IDS.users.creator,
          estimatedVnd: 145_000,
          spendingCapVnd: 500_000,
          remainingVnd: 355_000,
        },
      ]);
      expect(store.sharedEvents).toHaveLength(0);
    });

    it("applies manual edits, generates UUIDv4 stopId, enforces deterministic VND rounding, and allows 60% outdoor rain boundary", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 3,
          shareWithGroup: true,
          edits: {
            days: [
              {
                date: "2026-11-28",
                stops: [
                  {
                    placeId: "plc_hcmc_014",
                    startTime: "14:00",
                    endTime: "15:00",
                    selectedItems: [{ menuItemId: "itm_phohoa_odd", quantity: 1 }],
                  },
                  {
                    // 16:00 has exactly 60% rain -> boundary allowed (rule is strictly > 60%)
                    placeId: "plc_hcmc_088",
                    startTime: "16:00",
                    endTime: "16:45",
                    selectedItems: [],
                  },
                ],
              },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as SavedPlanResponse;
      expect(UUID_V4_REGEX.test(body.days[0]?.stops[0]?.stopId ?? "")).toBe(true);
      expect(body.days[0]?.stops[1]?.rainProbabilityPct).toBe(60);

      // 100,001 VND split across 4 members sorted ascending by userId -> 25001, 25000, 25000, 25000
      expect(body.budgetSummary.totalEstimatedVnd).toBe(100_001);
      expect(body.budgetSummary.memberBreakdown.map((m) => m.estimatedVnd)).toEqual([
        25_001, 25_000, 25_000, 25_000,
      ]);
      const sum = body.budgetSummary.memberBreakdown.reduce((acc, m) => acc + m.estimatedVnd, 0);
      expect(sum).toBe(body.budgetSummary.totalEstimatedVnd);
    });

    it("returns rainProbabilityPct as null when date is beyond the 7-day forecast horizon", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: INDIVIDUAL_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 1,
          edits: {
            days: [
              {
                date: "2026-12-08",
                stops: [
                  {
                    placeId: "plc_hcmc_088",
                    startTime: "16:00",
                    endTime: "17:30",
                    selectedItems: [],
                  },
                ],
              },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as SavedPlanResponse;
      expect(body.days[0]?.stops[0]?.rainProbabilityPct).toBeNull();
    });
  });

  describe("2. Authentication, Role & Ownership Matrix (RFC 9457)", () => {
    it("returns 401 unauthorized when Authorization header is missing, invalid, expired, or revoked", async () => {
      const { app, store } = createTestHarness();
      store.revokedCredentialIds.add("revoked-jti-001");

      const cases = [
        undefined,
        "Basic dXNlcjpwYXNz",
        "Bearer not.a.valid.jwt",
        bearerHeader(FIXTURE_IDS.users.creator, "member", { signingKey: "wrong-hmac-signing-key" }),
        bearerHeader(FIXTURE_IDS.users.creator, "member", { exp: EXPIRED_EXP }),
        bearerHeader(FIXTURE_IDS.users.creator, "member", { jti: "revoked-jti-001" }),
      ];

      for (const authHeader of cases) {
        const response = await app.inject({
          method: "POST",
          url: GROUP_PLAN_URL,
          headers: {
            ...(authHeader !== undefined ? { authorization: authHeader } : {}),
            "content-type": "application/json",
            "idempotency-key": IDEM_KEY_1,
          },
          payload: { expectedRevision: 3 },
        });

        assertProblemDetails(response, {
          status: 401,
          type: PROBLEM_TYPES.unauthorized,
          title: "Unauthorized",
          instance: GROUP_PLAN_URL,
        });
      }
    });

    it("returns 403 forbidden-role with requiredRole='member' for business and admin accounts", async () => {
      const { app } = createTestHarness();

      for (const [userId, role] of [
        [FIXTURE_IDS.users.businessUser, "business"],
        [FIXTURE_IDS.users.adminUser, "admin"],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url: GROUP_PLAN_URL,
          headers: {
            authorization: bearerHeader(userId, role),
            "content-type": "application/json",
            "idempotency-key": IDEM_KEY_1,
          },
          payload: { expectedRevision: 3 },
        });

        const problem = assertProblemDetails(response, {
          status: 403,
          type: PROBLEM_TYPES.forbiddenRole,
          title: "Forbidden Role",
          instance: GROUP_PLAN_URL,
        });
        expect(problem.requiredRole).toBe("member");
      }
    });

    it("returns 404 plan-not-found with planId when plan does not exist", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: UNKNOWN_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 1 },
      });

      const problem = assertProblemDetails(response, {
        status: 404,
        type: PROBLEM_TYPES.planNotFound,
        title: "Plan Not Found",
        instance: UNKNOWN_PLAN_URL,
      });
      expect(problem.planId).toBe(FIXTURE_IDS.plans.unknownPlan);
    });

    it("returns 403 ownership-violation for non-owner on individual trip", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: INDIVIDUAL_PLAN_URL,
        headers: {
          authorization: bearerHeader(FIXTURE_IDS.users.outsider, "member"),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 1 },
      });

      assertProblemDetails(response, {
        status: 403,
        type: PROBLEM_TYPES.ownershipViolation,
        title: "Ownership Violation",
        instance: INDIVIDUAL_PLAN_URL,
      });
    });

    it("returns 403 ownership-violation for outsider, non-creator active member, and removed creator on group trip", async () => {
      const { app } = createTestHarness();

      const scenarios = [
        {
          url: GROUP_PLAN_URL,
          userId: FIXTURE_IDS.users.outsider,
          expectedRevision: 3,
        },
        {
          // Active peer in group, but NOT plan.createdByUserId
          url: GROUP_PLAN_URL,
          userId: FIXTURE_IDS.users.activePeer,
          expectedRevision: 3,
        },
        {
          // Created draft earlier, but membership status is now "removed"
          url: REMOVED_CREATOR_PLAN_URL,
          userId: FIXTURE_IDS.users.removedMember,
          expectedRevision: 1,
        },
      ];

      for (const scenario of scenarios) {
        const response = await app.inject({
          method: "POST",
          url: scenario.url,
          headers: {
            authorization: bearerHeader(scenario.userId, "member"),
            "content-type": "application/json",
            "idempotency-key": IDEM_KEY_1,
          },
          payload: { expectedRevision: scenario.expectedRevision },
        });

        assertProblemDetails(response, {
          status: 403,
          type: PROBLEM_TYPES.ownershipViolation,
          title: "Ownership Violation",
          instance: scenario.url,
        });
      }
    });
  });

  describe("3. Transport, Headers & Strict Request Schema Validation", () => {
    it("returns 415 unsupported-media-type when Content-Type is not application/json", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "text/plain",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: '{"expectedRevision": 3}',
      });

      const problem = assertProblemDetails(response, {
        status: 415,
        type: PROBLEM_TYPES.unsupportedMediaType,
        title: "Unsupported Media Type",
        instance: GROUP_PLAN_URL,
      });
      expect(problem.acceptedMediaTypes).toEqual(["application/json"]);
    });

    it("returns 413 payload-too-large when payload exceeds 65536 bytes", async () => {
      const { app } = createTestHarness();
      const oversizedPayload = JSON.stringify({
        expectedRevision: 3,
        note: "a".repeat(70_000),
      });

      const response = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: oversizedPayload,
      });

      const problem = assertProblemDetails(response, {
        status: 413,
        type: PROBLEM_TYPES.payloadTooLarge,
        title: "Payload Too Large",
        instance: GROUP_PLAN_URL,
      });
      expect(problem.maxBytes).toBe(65_536);
    });

    it("returns 400 invalid-idempotency-key when Idempotency-Key header is missing or malformed", async () => {
      const { app } = createTestHarness();

      for (const badKey of [undefined, "short-key", "invalid key with spaces!!!"]) {
        const response = await app.inject({
          method: "POST",
          url: GROUP_PLAN_URL,
          headers: {
            authorization: bearerHeader(),
            "content-type": "application/json",
            ...(badKey !== undefined ? { "idempotency-key": badKey } : {}),
          },
          payload: { expectedRevision: 3 },
        });

        assertProblemDetails(response, {
          status: 400,
          type: PROBLEM_TYPES.invalidIdempotencyKey,
          title: "Invalid Idempotency Key",
          instance: GROUP_PLAN_URL,
        });
      }
    });

    it("returns 400 invalid-request for invalid planId, forbidden extra fields, and schema rule violations", async () => {
      const { app } = createTestHarness();

      // Invalid path UUIDv4
      const badPathResp = await app.inject({
        method: "POST",
        url: "/plans/not-a-uuid/save",
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 1 },
      });
      const badPathProblem = assertProblemDetails(badPathResp, {
        status: 400,
        type: PROBLEM_TYPES.invalidRequest,
        title: "Invalid Request",
        instance: "/plans/not-a-uuid/save",
      });
      expect(Array.isArray(badPathProblem.errors)).toBe(true);

      // Forbidden client-asserted price/validation fields (additionalProperties: false)
      const extraFieldResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 3,
          totalEstimatedVnd: 10_000,
          validationPassed: true,
        },
      });
      const extraFieldProblem = assertProblemDetails(extraFieldResp, {
        status: 400,
        type: PROBLEM_TYPES.invalidRequest,
        title: "Invalid Request",
        instance: GROUP_PLAN_URL,
      });
      expect(
        (extraFieldProblem.errors as Array<{ pointer: string }>).map((e) => e.pointer),
      ).toContain("/totalEstimatedVnd");

      // shareWithGroup: true on individual trip
      const indivShareResp = await app.inject({
        method: "POST",
        url: INDIVIDUAL_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 1,
          shareWithGroup: true,
        },
      });
      assertProblemDetails(indivShareResp, {
        status: 400,
        type: PROBLEM_TYPES.invalidRequest,
        title: "Invalid Request",
        instance: INDIVIDUAL_PLAN_URL,
      });

      // Duration < 15 minutes + duplicate menuItemId + control chars in note
      const invalidEditsResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 3,
          note: "hello\u0007bell",
          edits: {
            days: [
              {
                date: "2026-11-28",
                stops: [
                  {
                    placeId: "plc_hcmc_014",
                    startTime: "08:30",
                    endTime: "08:40",
                    selectedItems: [
                      { menuItemId: "itm_phohoa_01", quantity: 1 },
                      { menuItemId: "itm_phohoa_01", quantity: 1 },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
      assertProblemDetails(invalidEditsResp, {
        status: 400,
        type: PROBLEM_TYPES.invalidRequest,
        title: "Invalid Request",
        instance: GROUP_PLAN_URL,
      });
    });
  });

  describe("4. Idempotency, Concurrency & Lifecycle State Semantics", () => {
    it("replays exact 200 OK response on same Idempotency-Key + same canonical payload without double revision bump or double share", async () => {
      const { app, store } = createTestHarness();

      const first = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 3,
          shareWithGroup: true,
          note: "Weekend plan ready",
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers["idempotency-replayed"]).toBe("false");

      // Re-send with keys in different order (canonical JSON hash must match)
      const second = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          note: "Weekend plan ready",
          shareWithGroup: true,
          expectedRevision: 3,
        },
      });

      expect(second.statusCode).toBe(200);
      expect(second.headers["idempotency-key"]).toBe(IDEM_KEY_1);
      expect(second.headers["idempotency-replayed"]).toBe("true");
      expect(second.headers.etag).toBe('"rev-4"');
      expect(second.json()).toEqual(first.json());
      expect(store.sharedEvents).toHaveLength(1);
    });

    it("returns 422 idempotency-key-reused when same key is reused with a different payload", async () => {
      const { app } = createTestHarness();

      const first = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3, note: "First note" },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3, note: "Altered note" },
      });

      const problem = assertProblemDetails(second, {
        status: 422,
        type: PROBLEM_TYPES.idempotencyKeyReused,
        title: "Idempotency Key Reused With Different Payload",
        instance: GROUP_PLAN_URL,
      });
      expect(problem.idempotencyKey).toBe(IDEM_KEY_1);
    });

    it("isolates Idempotency-Key scope per user so another user never receives cached data", async () => {
      const { app } = createTestHarness();

      const ownerResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(FIXTURE_IDS.users.creator, "member"),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });
      expect(ownerResp.statusCode).toBe(200);

      const otherUserResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(FIXTURE_IDS.users.activePeer, "member"),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });

      assertProblemDetails(otherUserResp, {
        status: 403,
        type: PROBLEM_TYPES.ownershipViolation,
        title: "Ownership Violation",
        instance: GROUP_PLAN_URL,
      });
    });

    it("returns 409 idempotency-in-progress with Retry-After on concurrent duplicate request", async () => {
      let releaseFirst!: () => void;
      const waitGate = new Promise<void>((res) => {
        releaseFirst = res;
      });
      let notifyEntered!: () => void;
      const firstEntered = new Promise<void>((res) => {
        notifyEntered = res;
      });

      const { app } = createTestHarness({
        beforePersistHook: async () => {
          notifyEntered();
          await waitGate;
        },
      });

      const req1Promise = app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });

      await firstEntered;

      const req2 = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });

      const problem = assertProblemDetails(req2, {
        status: 409,
        type: PROBLEM_TYPES.idempotencyInProgress,
        title: "Request In Progress",
        instance: GROUP_PLAN_URL,
      });
      expect(problem.retryAfterSeconds).toBe(1);
      expect(req2.headers["retry-after"]).toBe("1");

      releaseFirst();
      const req1 = await req1Promise;
      expect(req1.statusCode).toBe(200);
    });

    it("handles natural state idempotency, plan-state-conflict, and revision-conflict accurately", async () => {
      const { app, store } = createTestHarness();

      // 1) Generating plan -> 409 plan-state-conflict
      const generatingResp = await app.inject({
        method: "POST",
        url: GENERATING_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 1 },
      });
      const generatingProblem = assertProblemDetails(generatingResp, {
        status: 409,
        type: PROBLEM_TYPES.planStateConflict,
        title: "Plan State Conflict",
        instance: GENERATING_PLAN_URL,
      });
      expect(generatingProblem.currentStatus).toBe("generating");
      expect(generatingProblem.allowedStatuses).toEqual(["draft"]);

      // 2) Draft with wrong expectedRevision -> 409 revision-conflict
      const staleRevResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 2 },
      });
      const staleRevProblem = assertProblemDetails(staleRevResp, {
        status: 409,
        type: PROBLEM_TYPES.revisionConflict,
        title: "Revision Conflict",
        instance: GROUP_PLAN_URL,
      });
      expect(staleRevProblem.expectedRevision).toBe(2);
      expect(staleRevProblem.currentRevision).toBe(3);

      // 3) Save successfully (revision 3 -> 4)
      const saveResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3, shareWithGroup: true },
      });
      expect(saveResp.statusCode).toBe(200);
      expect(store.sharedEvents).toHaveLength(1);

      // 4) Natural state idempotency with a NEW key and matching expectedRevision=4 -> 200 OK, no revision bump, no re-share
      const naturalResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_2,
        },
        payload: { expectedRevision: 4, shareWithGroup: true },
      });
      expect(naturalResp.statusCode).toBe(200);
      expect(naturalResp.headers["idempotency-replayed"]).toBe("false");
      expect((naturalResp.json() as SavedPlanResponse).revision).toBe(4);
      expect(store.sharedEvents).toHaveLength(1);

      // 5) New key attempting edits on already-saved plan -> 409 plan-state-conflict
      const postSaveEditResp = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": "99999999-aaaa-4bbb-8ccc-dddddddddddd",
        },
        payload: {
          expectedRevision: 4,
          edits: {
            days: [
              {
                date: "2026-11-28",
                stops: [
                  {
                    placeId: "plc_hcmc_014",
                    startTime: "08:30",
                    endTime: "09:30",
                    selectedItems: [],
                  },
                ],
              },
            ],
          },
        },
      });
      const postSaveProblem = assertProblemDetails(postSaveEditResp, {
        status: 409,
        type: PROBLEM_TYPES.planStateConflict,
        title: "Plan State Conflict",
        instance: GROUP_PLAN_URL,
      });
      expect(postSaveProblem.currentStatus).toBe("saved");
    });
  });

  describe("5. Backend Validator (All 5 Rules, Multi-Violation Collection & Fail-Closed)", () => {
    it("collects ALL violations across opening hours, travel time, rain risk, and budget in a single 422 response and mutates nothing", async () => {
      const { app, store } = createTestHarness();

      const payload = {
        expectedRevision: 3,
        shareWithGroup: true,
        edits: {
          days: [
            {
              date: "2026-11-28",
              stops: [
                {
                  stopId: "f1000001-0000-4000-8000-000000000001",
                  placeId: "plc_hcmc_003",
                  // Closes at 16:30 on Saturday -> OUTSIDE_OPENING_HOURS
                  startTime: "15:30",
                  endTime: "17:15",
                  selectedItems: [],
                },
                {
                  stopId: "f1000001-0000-4000-8000-000000000002",
                  placeId: "plc_hcmc_088",
                  // Travel 003->088 needs 28 min, gap is 10 min -> TRAVEL_TIME_EXCEEDED
                  // Outdoor stop at 17:25-18:00 overlaps 17:00 (75% rain > 60%) -> RAIN_RISK_OUTDOOR
                  startTime: "17:25",
                  endTime: "18:00",
                  selectedItems: [],
                },
                {
                  stopId: "f1000001-0000-4000-8000-000000000003",
                  placeId: "plc_hcmc_099",
                  // Expensive tasting menus: 4 * 900,000 + 4 * 200,000 + 4 * 40,000 = 4,560,000 VND
                  // Exceeds group_total (3,600,000) AND member caps -> BUDGET_EXCEEDED
                  startTime: "19:00",
                  endTime: "21:00",
                  selectedItems: [{ menuItemId: "itm_sky_01", quantity: 4 }],
                },
              ],
            },
          ],
        },
      };

      const response = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload,
      });

      const problem = assertProblemDetails(response, {
        status: 422,
        type: PROBLEM_TYPES.planValidationFailed,
        title: "Plan Validation Failed",
        instance: GROUP_PLAN_URL,
      });
      expect(problem.validatorVersion).toBe("1.0.0");
      expect(response.headers["idempotency-replayed"]).toBe("false");

      const violations = problem.violations as Array<{
        code: string;
        details: Record<string, unknown>;
      }>;
      const codes = violations.map((v) => v.code);
      expect(codes).toContain("OUTSIDE_OPENING_HOURS");
      expect(codes).toContain("TRAVEL_TIME_EXCEEDED");
      expect(codes).toContain("RAIN_RISK_OUTDOOR");
      expect(codes).toContain("BUDGET_EXCEEDED");

      // Nothing was saved or shared
      const planAfter = store.plans.get(FIXTURE_IDS.plans.groupDraft);
      expect(planAfter?.status).toBe("draft");
      expect(planAfter?.revision).toBe(3);
      expect(planAfter?.sharedWithGroup).toBe(false);
      expect(store.sharedEvents).toHaveLength(0);

      // Deterministic 422 is cached and replayed on same Idempotency-Key
      const replay = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload,
      });
      expect(replay.statusCode).toBe(422);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(replay.json()).toEqual(response.json());
    });

    it("detects PLACE_NOT_FOUND (unknown, missing_hours, missing_menu), MENU_ITEM_NOT_FOUND, and public holiday closures", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 3,
          edits: {
            days: [
              {
                date: "2026-11-30",
                stops: [
                  {
                    placeId: "plc_unknown_999",
                    startTime: "08:00",
                    endTime: "09:00",
                    selectedItems: [],
                  },
                  {
                    placeId: "plc_hcmc_no_hours",
                    startTime: "10:00",
                    endTime: "11:00",
                    selectedItems: [],
                  },
                  {
                    placeId: "plc_hcmc_no_menu",
                    startTime: "12:00",
                    endTime: "13:00",
                    selectedItems: [],
                  },
                  {
                    placeId: "plc_hcmc_003",
                    // Closed on public holiday 2026-11-30 + nonexistent menu item
                    startTime: "14:00",
                    endTime: "15:00",
                    selectedItems: [{ menuItemId: "itm_fake_item", quantity: 1 }],
                  },
                ],
              },
            ],
          },
        },
      });

      const problem = assertProblemDetails(response, {
        status: 422,
        type: PROBLEM_TYPES.planValidationFailed,
        title: "Plan Validation Failed",
        instance: GROUP_PLAN_URL,
      });
      const violations = problem.violations as Array<{
        code: string;
        details: Record<string, unknown>;
      }>;

      expect(
        violations.some(
          (v) => v.code === "PLACE_NOT_FOUND" && v.details.reason === "unknown_place",
        ),
      ).toBe(true);
      expect(
        violations.some(
          (v) => v.code === "PLACE_NOT_FOUND" && v.details.reason === "missing_hours",
        ),
      ).toBe(true);
      expect(
        violations.some((v) => v.code === "PLACE_NOT_FOUND" && v.details.reason === "missing_menu"),
      ).toBe(true);
      expect(violations.some((v) => v.code === "MENU_ITEM_NOT_FOUND")).toBe(true);
      expect(
        violations.some(
          (v) => v.code === "OUTSIDE_OPENING_HOURS" && v.details.openingHours === "CLOSED",
        ),
      ).toBe(true);
    });

    it("enforces individual budget cap with BUDGET_EXCEEDED scope='individual'", async () => {
      const { app } = createTestHarness();

      const response = await app.inject({
        method: "POST",
        url: INDIVIDUAL_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: {
          expectedRevision: 1,
          edits: {
            days: [
              {
                date: "2026-11-28",
                stops: [
                  {
                    placeId: "plc_hcmc_099",
                    startTime: "18:00",
                    endTime: "20:00",
                    selectedItems: [{ menuItemId: "itm_sky_01", quantity: 1 }],
                  },
                ],
              },
            ],
          },
        },
      });

      const problem = assertProblemDetails(response, {
        status: 422,
        type: PROBLEM_TYPES.planValidationFailed,
        title: "Plan Validation Failed",
        instance: INDIVIDUAL_PLAN_URL,
      });
      const violations = problem.violations as Array<{
        code: string;
        details: Record<string, unknown>;
      }>;
      expect(violations).toHaveLength(1);
      expect(violations[0]?.code).toBe("BUDGET_EXCEEDED");
      expect(violations[0]?.details.scope).toBe("individual");
      expect(violations[0]?.details.estimatedVnd).toBe(1_100_000);
      expect(violations[0]?.details.limitVnd).toBe(500_000);
      expect(violations[0]?.details.excessVnd).toBe(600_000);
    });

    it("fails closed with 503 validator-dependency-unavailable, does NOT cache transient failure, and succeeds on same-key retry", async () => {
      let dependencyOutage: ValidatorDependencyName | null = "open-meteo-forecast";
      const { app, store } = createTestHarness({
        unavailableDependency: () => dependencyOutage,
      });

      const failed = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });

      const problem = assertProblemDetails(failed, {
        status: 503,
        type: PROBLEM_TYPES.validatorDependencyUnavailable,
        title: "Validator Dependency Unavailable",
        instance: GROUP_PLAN_URL,
      });
      expect(problem.dependency).toBe("open-meteo-forecast");
      expect(problem.retryAfterSeconds).toBe(5);
      expect(failed.headers["retry-after"]).toBe("5");
      expect(store.plans.get(FIXTURE_IDS.plans.groupDraft)?.status).toBe("draft");
      expect(store.sharedEvents).toHaveLength(0);

      // Dependency recovers -> retrying with the exact SAME Idempotency-Key executes cleanly
      dependencyOutage = null;
      const recovered = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.headers["idempotency-replayed"]).toBe("false");
    });

    it("returns 429 rate-limited and 500 internal-error as transient non-cached RFC 9457 responses", async () => {
      let blockRate = true;
      let throwInternal = false;

      const { app } = createTestHarness({
        checkRateLimit: () =>
          blockRate ? { allowed: false, retryAfterSeconds: 15 } : { allowed: true },
        injectUnexpectedError: () => (throwInternal ? new Error("simulated db crash") : null),
      });

      const rateLimited = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });
      const rateProblem = assertProblemDetails(rateLimited, {
        status: 429,
        type: PROBLEM_TYPES.rateLimited,
        title: "Too Many Requests",
        instance: GROUP_PLAN_URL,
      });
      expect(rateProblem.retryAfterSeconds).toBe(15);
      expect(rateLimited.headers["retry-after"]).toBe("15");

      blockRate = false;
      throwInternal = true;
      const internal = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });
      const internalProblem = assertProblemDetails(internal, {
        status: 500,
        type: PROBLEM_TYPES.internalError,
        title: "Internal Server Error",
        instance: GROUP_PLAN_URL,
      });
      // Must never leak internal error details or stack traces
      expect(String(internalProblem.detail)).not.toContain("simulated db crash");

      // Both 429 and 500 were transient -> same Idempotency-Key succeeds once healthy
      throwInternal = false;
      const ok = await app.inject({
        method: "POST",
        url: GROUP_PLAN_URL,
        headers: {
          authorization: bearerHeader(),
          "content-type": "application/json",
          "idempotency-key": IDEM_KEY_1,
        },
        payload: { expectedRevision: 3 },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers["idempotency-replayed"]).toBe("false");
    });
  });
});
