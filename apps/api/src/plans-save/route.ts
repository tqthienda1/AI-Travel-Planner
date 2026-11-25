import { randomUUID } from "node:crypto";
import { PROBLEM_CONTENT_TYPE, createProblemDetails } from "@ai-travel-planner/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEFAULT_LOCAL_HMAC_KEY, verifyAuthorizationHeader } from "./auth.js";
import { createDefaultCheckedDataset } from "./dataset.js";
import {
  IDEMPOTENCY_KEY_REGEX,
  UUID_V4_REGEX,
  normalizeNote,
  validateSavePlanRequestBody,
} from "./schema.js";
import { computeCanonicalPayloadHash, createDefaultPlansSaveStore } from "./store.js";
import type {
  FieldError,
  PlansSaveRuntimeOptions,
  SavedPlanResponse,
  TripRecord,
} from "./types.js";
import {
  ATTRIBUTIONS,
  CONTRACT_VERSION,
  MAX_BODY_BYTES,
  PROBLEM_TYPES,
  VALIDATOR_VERSION,
} from "./types.js";
import { computeCostAndValidatePlan } from "./validator.js";

const JSON_CONTENT_TYPE_REGEX = /^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i;

function isAcceptedJsonContentType(headerValue: string | undefined): boolean {
  if (!headerValue) {
    return false;
  }
  return JSON_CONTENT_TYPE_REGEX.test(headerValue.trim());
}

function sendProblem(
  reply: FastifyReply,
  input: {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    requestId: string;
    extensions?: Record<string, unknown>;
    extraHeaders?: Record<string, string>;
  },
): FastifyReply {
  const problem = createProblemDetails({
    type: input.type,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    extensions: {
      requestId: input.requestId,
      ...(input.extensions ?? {}),
    },
  });

  reply.header("X-Request-Id", input.requestId);
  reply.header("X-Contract-Version", CONTRACT_VERSION);
  if (input.extraHeaders) {
    for (const [headerName, headerVal] of Object.entries(input.extraHeaders)) {
      reply.header(headerName, headerVal);
    }
  }

  return reply.code(input.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

function validateContextualRequestRules(
  body: ReturnType<typeof validateSavePlanRequestBody> & { ok: true },
  trip: TripRecord,
  activeMemberIds: ReadonlySet<string>,
): FieldError[] {
  const errors: FieldError[] = [];
  const data = body.data;

  if (trip.mode === "individual" && data.shareWithGroup === true) {
    errors.push({
      pointer: "/shareWithGroup",
      code: "invalid_value",
      message: "shareWithGroup cannot be true for an individual trip.",
    });
  }

  if (data.edits) {
    data.edits.days.forEach((day, dayIdx) => {
      if (day.date < trip.startDate || day.date > trip.endDate) {
        errors.push({
          pointer: `/edits/days/${dayIdx}/date`,
          code: "out_of_trip_range",
          message: `Date '${day.date}' must lie within [${trip.startDate}, ${trip.endDate}].`,
        });
      }

      day.stops.forEach((stop, stopIdx) => {
        stop.selectedItems.forEach((item, itemIdx) => {
          if (!item.assignedMemberIds) return;
          if (trip.mode === "individual") {
            if (
              item.assignedMemberIds.length !== 1 ||
              item.assignedMemberIds[0] !== trip.ownerUserId
            ) {
              errors.push({
                pointer: `/edits/days/${dayIdx}/stops/${stopIdx}/selectedItems/${itemIdx}/assignedMemberIds`,
                code: "invalid_assignee",
                message: "In individual mode, assignedMemberIds must be omitted or [ownerUserId].",
              });
            }
          } else {
            item.assignedMemberIds.forEach((memberId, mIdx) => {
              if (!activeMemberIds.has(memberId)) {
                errors.push({
                  pointer: `/edits/days/${dayIdx}/stops/${stopIdx}/selectedItems/${itemIdx}/assignedMemberIds/${mIdx}`,
                  code: "invalid_assignee",
                  message: `Member '${memberId}' is not an active member of this trip group.`,
                });
              }
            });
          }
        });
      });
    });
  }

  return errors;
}

export async function registerPlansSavePlugin(
  app: FastifyInstance,
  options: PlansSaveRuntimeOptions = {},
): Promise<void> {
  const store = options.store ?? createDefaultPlansSaveStore();
  const dataset = options.dataset ?? createDefaultCheckedDataset();
  const signingKey = options.signingKey ?? DEFAULT_LOCAL_HMAC_KEY;
  const now = options.now ?? (() => new Date());

  // Accept any Content-Type in this encapsulated plugin so Step 1 can deterministically
  // emit RFC 9457 415 unsupported-media-type instead of Fastify's generic 415 error.
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer", bodyLimit: MAX_BODY_BYTES },
    (_request, payload, done) => {
      done(null, payload);
    },
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    const requestId = randomUUID();
    const instance = request.url.split("?")[0] ?? request.url;
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;

    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendProblem(reply, {
        type: PROBLEM_TYPES.payloadTooLarge,
        title: "Payload Too Large",
        status: 413,
        detail: `Request payload exceeds the maximum allowed size of ${MAX_BODY_BYTES} bytes.`,
        instance,
        requestId,
        extensions: { maxBytes: MAX_BODY_BYTES },
      });
    }

    if (code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return sendProblem(reply, {
        type: PROBLEM_TYPES.invalidRequest,
        title: "Invalid Request",
        status: 400,
        detail: "Request body must be a valid JSON object.",
        instance,
        requestId,
        extensions: {
          errors: [
            {
              pointer: "",
              code: "invalid_json",
              message: "Malformed or empty JSON request body.",
            },
          ],
        },
      });
    }

    return sendProblem(reply, {
      type: PROBLEM_TYPES.internalError,
      title: "Internal Server Error",
      status: 500,
      detail: "An unexpected error occurred while processing the request.",
      instance,
      requestId,
    });
  });

  app.post(
    "/plans/:planId/save",
    { bodyLimit: MAX_BODY_BYTES },
    async (request: FastifyRequest<{ Params: { planId: string } }>, reply: FastifyReply) => {
      const requestId = randomUUID();
      const instance = request.url.split("?")[0] ?? request.url;
      const currentTime = now();

      // Step 1: Content-Type & Payload Size
      const contentTypeHeader = request.headers["content-type"];
      if (!isAcceptedJsonContentType(contentTypeHeader)) {
        return sendProblem(reply, {
          type: PROBLEM_TYPES.unsupportedMediaType,
          title: "Unsupported Media Type",
          status: 415,
          detail: "Content-Type must be 'application/json'.",
          instance,
          requestId,
          extensions: { acceptedMediaTypes: ["application/json"] },
        });
      }

      // Step 2: Authentication
      const caller = verifyAuthorizationHeader(request.headers.authorization, {
        signingKey,
        now: currentTime,
        revokedIds: store.revokedCredentialIds,
      });
      if (!caller) {
        return sendProblem(reply, {
          type: PROBLEM_TYPES.unauthorized,
          title: "Unauthorized",
          status: 401,
          detail: "Missing or expired Bearer access token.",
          instance,
          requestId,
        });
      }

      // Step 3: Path Parameter, Idempotency-Key Header, and Body Schema Validation
      const { planId } = request.params;
      if (!UUID_V4_REGEX.test(planId)) {
        return sendProblem(reply, {
          type: PROBLEM_TYPES.invalidRequest,
          title: "Invalid Request",
          status: 400,
          detail: "Path parameter 'planId' must be a lowercase UUIDv4.",
          instance,
          requestId,
          extensions: {
            errors: [
              {
                pointer: "/planId",
                code: "invalid_format",
                message: "planId must be a lowercase UUIDv4.",
              },
            ],
          },
        });
      }

      const rawIdempotencyKey = request.headers["idempotency-key"];
      const idempotencyKey =
        typeof rawIdempotencyKey === "string" ? rawIdempotencyKey.trim() : undefined;
      if (!idempotencyKey || !IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
        return sendProblem(reply, {
          type: PROBLEM_TYPES.invalidIdempotencyKey,
          title: "Invalid Idempotency Key",
          status: 400,
          detail: "Header 'Idempotency-Key' is required and must match ^[A-Za-z0-9._-]{16,128}$.",
          instance,
          requestId,
        });
      }

      const bodyValidation = validateSavePlanRequestBody(request.body);
      if (!bodyValidation.ok) {
        return sendProblem(reply, {
          type: PROBLEM_TYPES.invalidRequest,
          title: "Invalid Request",
          status: 400,
          detail: "Request body failed schema validation.",
          instance,
          requestId,
          extensions: { errors: bodyValidation.errors },
        });
      }
      const requestBody = bodyValidation.data;

      // Step 4: Rate Limiting
      if (options.checkRateLimit) {
        const rateDecision = options.checkRateLimit(caller.userId);
        if (!rateDecision.allowed) {
          const retryAfterSeconds = rateDecision.retryAfterSeconds ?? 15;
          return sendProblem(reply, {
            type: PROBLEM_TYPES.rateLimited,
            title: "Too Many Requests",
            status: 429,
            detail: `Save rate limit exceeded. Wait ${retryAfterSeconds} seconds before retrying.`,
            instance,
            requestId,
            extensions: { retryAfterSeconds },
            extraHeaders: { "Retry-After": String(retryAfterSeconds) },
          });
        }
      }

      // Step 5: Idempotency Store Lookup
      const scopeKey = store.buildIdempotencyScopeKey(caller.userId, planId, idempotencyKey);
      const payloadHash = computeCanonicalPayloadHash(request.body);
      const existingRecord = store.getActiveIdempotencyRecord(scopeKey, currentTime.getTime());

      if (existingRecord) {
        if (existingRecord.status === "in_progress") {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.idempotencyInProgress,
            title: "Request In Progress",
            status: 409,
            detail:
              "Another save request with the same Idempotency-Key is currently processing. Retry shortly with the same key.",
            instance,
            requestId,
            extensions: { retryAfterSeconds: 1 },
            extraHeaders: { "Retry-After": "1" },
          });
        }

        if (existingRecord.payloadHash !== payloadHash) {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.idempotencyKeyReused,
            title: "Idempotency Key Reused With Different Payload",
            status: 422,
            detail: `Idempotency-Key '${idempotencyKey}' was already used with a different request payload.`,
            instance,
            requestId,
            extensions: { idempotencyKey },
          });
        }

        const replayStatus = existingRecord.responseStatusCode ?? 200;
        const replayContentType =
          existingRecord.responseContentType ?? "application/json; charset=utf-8";
        reply.header("Idempotency-Key", idempotencyKey);
        reply.header("Idempotency-Replayed", "true");
        reply.header("X-Request-Id", requestId);
        reply.header("X-Contract-Version", CONTRACT_VERSION);
        if (existingRecord.etag) {
          reply.header("ETag", existingRecord.etag);
        }
        return reply.code(replayStatus).type(replayContentType).send(existingRecord.responseBody);
      }

      store.idempotencyRecords.set(scopeKey, {
        status: "in_progress",
        payloadHash,
        completedAtMs: 0,
      });

      let shouldKeepIdempotencyRecord = false;

      try {
        if (options.beforePersistHook) {
          await options.beforePersistHook();
        }

        // Step 6: Role Check, Plan Lookup, and Ownership Check
        if (caller.role !== "member") {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.forbiddenRole,
            title: "Forbidden Role",
            status: 403,
            detail: `Accounts with role '${caller.role}' are not permitted to save travel plans.`,
            instance,
            requestId,
            extensions: { requiredRole: "member" },
          });
        }

        const plan = store.plans.get(planId);
        if (!plan) {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.planNotFound,
            title: "Plan Not Found",
            status: 404,
            detail: `No plan exists with id '${planId}'.`,
            instance,
            requestId,
            extensions: { planId },
          });
        }

        const trip = store.trips.get(plan.tripId);
        if (!trip) {
          throw new Error(`Parent trip '${plan.tripId}' is missing for plan '${planId}'.`);
        }

        const group = trip.groupId ? (store.groups.get(trip.groupId) ?? null) : null;
        const activeMemberIds = new Set<string>(
          trip.mode === "group" && group
            ? group.members.filter((m) => m.status === "active").map((m) => m.userId)
            : [trip.ownerUserId],
        );

        // Deliberate contract break (KAN-13): relax group draft creator check and emit a
        // non-contract RFC 9457 problem type to prove contract tests catch regressions and block CI.
        const isOwnerAuthorized =
          trip.mode === "individual"
            ? caller.userId === plan.ownerUserId
            : activeMemberIds.has(caller.userId);

        if (!isOwnerAuthorized) {
          return sendProblem(reply, {
            type: "https://ai-travel-planner.local/problems/forbidden",
            title: "Forbidden",
            status: 403,
            detail: "You do not own this plan draft or are not an active member of its trip group.",
            instance,
            requestId,
          });
        }

        // Trip-contextual request checks (still 400 invalid-request per contract Section 3.3)
        const contextualErrors = validateContextualRequestRules(
          bodyValidation,
          trip,
          activeMemberIds,
        );
        if (contextualErrors.length > 0) {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.invalidRequest,
            title: "Invalid Request",
            status: 400,
            detail: "Request body violates trip context constraints.",
            instance,
            requestId,
            extensions: { errors: contextualErrors },
          });
        }

        // Step 7: Lifecycle State Check, Natural Idempotency Check, and Optimistic Concurrency
        const effectiveShareWithGroup = requestBody.shareWithGroup ?? trip.mode === "group";
        const normalizedRequestNote =
          requestBody.note === undefined ? undefined : normalizeNote(requestBody.note);

        if (plan.status === "saved") {
          const shareMatches =
            requestBody.shareWithGroup === undefined ||
            requestBody.shareWithGroup === plan.sharedWithGroup;
          const noteMatches =
            normalizedRequestNote === undefined || normalizedRequestNote === plan.note;

          if (requestBody.edits !== undefined || !shareMatches || !noteMatches) {
            return sendProblem(reply, {
              type: PROBLEM_TYPES.planStateConflict,
              title: "Plan State Conflict",
              status: 409,
              detail:
                "Plan is already saved and cannot be modified via save. Use the post-save edit flow.",
              instance,
              requestId,
              extensions: {
                currentStatus: plan.status,
                allowedStatuses: ["draft"],
              },
            });
          }

          if (requestBody.expectedRevision !== plan.revision) {
            return sendProblem(reply, {
              type: PROBLEM_TYPES.revisionConflict,
              title: "Revision Conflict",
              status: 409,
              detail: `Expected revision ${requestBody.expectedRevision} does not match current plan revision ${plan.revision}. Reload the latest plan before saving.`,
              instance,
              requestId,
              extensions: {
                expectedRevision: requestBody.expectedRevision,
                currentRevision: plan.revision,
              },
            });
          }

          // Natural state idempotency: return saved snapshot without bumping revision or re-sharing
          if (!plan.savedSnapshot) {
            throw new Error(`Saved plan '${planId}' is missing its saved snapshot.`);
          }

          const etag = `"rev-${plan.revision}"`;
          store.idempotencyRecords.set(scopeKey, {
            status: "completed",
            payloadHash,
            completedAtMs: currentTime.getTime(),
            responseStatusCode: 200,
            responseBody: plan.savedSnapshot as unknown as Record<string, unknown>,
            responseContentType: "application/json; charset=utf-8",
            etag,
          });
          shouldKeepIdempotencyRecord = true;

          reply.header("Idempotency-Key", idempotencyKey);
          reply.header("Idempotency-Replayed", "false");
          reply.header("ETag", etag);
          reply.header("X-Request-Id", requestId);
          reply.header("X-Contract-Version", CONTRACT_VERSION);
          return reply.code(200).type("application/json; charset=utf-8").send(plan.savedSnapshot);
        }

        if (plan.status !== "draft") {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.planStateConflict,
            title: "Plan State Conflict",
            status: 409,
            detail: `Plan is currently in status '${plan.status}' and cannot be saved until draft generation finishes.`,
            instance,
            requestId,
            extensions: {
              currentStatus: plan.status,
              allowedStatuses: ["draft"],
            },
          });
        }

        if (requestBody.expectedRevision !== plan.revision) {
          return sendProblem(reply, {
            type: PROBLEM_TYPES.revisionConflict,
            title: "Revision Conflict",
            status: 409,
            detail: `Expected revision ${requestBody.expectedRevision} does not match current plan revision ${plan.revision}. Reload the latest plan before saving.`,
            instance,
            requestId,
            extensions: {
              expectedRevision: requestBody.expectedRevision,
              currentRevision: plan.revision,
            },
          });
        }

        // Unexpected fault hook for 500 testing (transient: never cached)
        if (options.injectUnexpectedError) {
          const injected = options.injectUnexpectedError();
          if (injected) {
            throw injected;
          }
        }

        // Step 8: Fail-Closed Validator Dependency Check + Deterministic Cost & Validation
        if (options.unavailableDependency) {
          const dependency = options.unavailableDependency();
          if (dependency) {
            return sendProblem(reply, {
              type: PROBLEM_TYPES.validatorDependencyUnavailable,
              title: "Validator Dependency Unavailable",
              status: 503,
              detail: `Unable to verify required data from '${dependency}'. Save aborted to prevent sharing an unvalidated schedule.`,
              instance,
              requestId,
              extensions: {
                dependency,
                retryAfterSeconds: 5,
              },
              extraHeaders: { "Retry-After": "5" },
            });
          }
        }

        const candidateDays = requestBody.edits ? requestBody.edits.days : plan.draftDays;
        const validationResult = computeCostAndValidatePlan({
          trip,
          group,
          days: candidateDays,
          dataset,
          now: currentTime,
        });

        if (validationResult.violations.length > 0) {
          const problemBody = createProblemDetails({
            type: PROBLEM_TYPES.planValidationFailed,
            title: "Plan Validation Failed",
            status: 422,
            detail: `Backend validator found ${validationResult.violations.length} blocking violation(s). The plan was not saved or shared with the group.`,
            instance,
            extensions: {
              requestId,
              validatorVersion: VALIDATOR_VERSION,
              violations: validationResult.violations,
            },
          });

          store.idempotencyRecords.set(scopeKey, {
            status: "completed",
            payloadHash,
            completedAtMs: currentTime.getTime(),
            responseStatusCode: 422,
            responseBody: problemBody as unknown as Record<string, unknown>,
            responseContentType: PROBLEM_CONTENT_TYPE,
          });
          shouldKeepIdempotencyRecord = true;

          reply.header("Idempotency-Key", idempotencyKey);
          reply.header("Idempotency-Replayed", "false");
          reply.header("X-Request-Id", requestId);
          reply.header("X-Contract-Version", CONTRACT_VERSION);
          return reply.code(422).type(PROBLEM_CONTENT_TYPE).send(problemBody);
        }

        // Step 9: Atomic Persist, Group Share Publish, Audit Log & Idempotency Commit
        const nextRevision = plan.revision + 1;
        const savedAtIso = currentTime.toISOString().replace(/\.\d{3}Z$/, "Z");
        const finalNote = normalizeNote(requestBody.note);
        const sharedAt = effectiveShareWithGroup ? savedAtIso : null;
        const shareUrl =
          effectiveShareWithGroup && trip.groupId
            ? `https://ai-travel-planner.local/groups/${trip.groupId}/plans/${plan.planId}`
            : null;

        const responseBody: SavedPlanResponse = {
          planId: plan.planId,
          tripId: plan.tripId,
          groupId: trip.groupId,
          status: "saved",
          revision: nextRevision,
          sharedWithGroup: effectiveShareWithGroup,
          sharedAt,
          savedAt: savedAtIso,
          savedByUserId: caller.userId,
          note: finalNote,
          shareUrl,
          validation: validationResult.validation,
          budgetSummary: validationResult.budgetSummary,
          days: validationResult.days,
          attributions: ATTRIBUTIONS,
        };

        plan.status = "saved";
        plan.revision = nextRevision;
        plan.sharedWithGroup = effectiveShareWithGroup;
        plan.sharedAt = sharedAt;
        plan.savedAt = savedAtIso;
        plan.savedByUserId = caller.userId;
        plan.note = finalNote;
        plan.shareUrl = shareUrl;
        plan.draftDays = candidateDays;
        plan.savedSnapshot = responseBody;

        if (effectiveShareWithGroup && trip.groupId) {
          store.sharedEvents.push({
            planId: plan.planId,
            groupId: trip.groupId,
            revision: nextRevision,
            sharedAt: savedAtIso,
            sharedByUserId: caller.userId,
          });
        }

        const etag = `"rev-${nextRevision}"`;
        store.idempotencyRecords.set(scopeKey, {
          status: "completed",
          payloadHash,
          completedAtMs: currentTime.getTime(),
          responseStatusCode: 200,
          responseBody: responseBody as unknown as Record<string, unknown>,
          responseContentType: "application/json; charset=utf-8",
          etag,
        });
        shouldKeepIdempotencyRecord = true;

        reply.header("Idempotency-Key", idempotencyKey);
        reply.header("Idempotency-Replayed", "false");
        reply.header("ETag", etag);
        reply.header("X-Request-Id", requestId);
        reply.header("X-Contract-Version", CONTRACT_VERSION);
        return reply.code(200).type("application/json; charset=utf-8").send(responseBody);
      } finally {
        if (!shouldKeepIdempotencyRecord) {
          store.idempotencyRecords.delete(scopeKey);
        }
      }
    },
  );
}
