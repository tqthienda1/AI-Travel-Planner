import { createHash } from "node:crypto";
import type {
  GroupRecord,
  IdempotencyRecord,
  PlanRecord,
  ShareEvent,
  TripRecord,
} from "./types.js";
import { IDEMPOTENCY_TTL_MS } from "./types.js";

export const FIXTURE_IDS = {
  users: {
    creator: "11111111-1111-4111-8111-111111111111",
    activePeer: "22222222-2222-4222-8222-222222222222",
    lowestCapMember: "33333333-3333-4333-8333-333333333333",
    fourthMember: "44444444-4444-4444-8444-444444444444",
    removedMember: "55555555-5555-4555-8555-555555555555",
    outsider: "66666666-6666-4666-8666-666666666666",
    businessUser: "77777777-7777-4777-8777-777777777777",
    adminUser: "88888888-8888-4888-8888-888888888888",
  },
  groups: {
    weekendGroup: "770e8400-e29b-41d4-a716-446655440099",
  },
  trips: {
    groupTrip: "550e8400-e29b-41d4-a716-446655440000",
    individualTrip: "550e8400-e29b-41d4-a716-446655440001",
  },
  plans: {
    groupDraft: "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5d",
    individualDraft: "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5e",
    generatingDraft: "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c5f",
    removedCreatorDraft: "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c60",
    unknownPlan: "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c99",
  },
  stops: {
    phoHoa: "a1000001-0000-4000-8000-000000000001",
    dinhDocLap: "a1000001-0000-4000-8000-000000000002",
    cheoLeo: "a1000001-0000-4000-8000-000000000003",
  },
} as const;

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`).join(",")}}`;
}

export function computeCanonicalPayloadHash(body: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(body), "utf8").digest("hex");
}

export class PlansSaveStore {
  public readonly plans = new Map<string, PlanRecord>();
  public readonly trips = new Map<string, TripRecord>();
  public readonly groups = new Map<string, GroupRecord>();
  public readonly idempotencyRecords = new Map<string, IdempotencyRecord>();
  public readonly revokedCredentialIds = new Set<string>();
  public readonly sharedEvents: ShareEvent[] = [];

  public buildIdempotencyScopeKey(userId: string, planId: string, idempotencyKey: string): string {
    return `${userId}:POST:/plans/${planId}/save:${idempotencyKey}`;
  }

  public getActiveIdempotencyRecord(
    scopeKey: string,
    nowMs: number,
  ): IdempotencyRecord | undefined {
    const existing = this.idempotencyRecords.get(scopeKey);
    if (!existing) {
      return undefined;
    }
    if (existing.status === "completed" && nowMs - existing.completedAtMs >= IDEMPOTENCY_TTL_MS) {
      this.idempotencyRecords.delete(scopeKey);
      return undefined;
    }
    return existing;
  }
}

export function createDefaultPlansSaveStore(): PlansSaveStore {
  const store = new PlansSaveStore();

  store.groups.set(FIXTURE_IDS.groups.weekendGroup, {
    groupId: FIXTURE_IDS.groups.weekendGroup,
    groupBudgetLimitVnd: 3_600_000,
    members: [
      {
        userId: FIXTURE_IDS.users.creator,
        displayName: "Thịnh",
        status: "active",
        spendingCapVnd: 1_000_000,
      },
      {
        userId: FIXTURE_IDS.users.activePeer,
        displayName: "Long",
        status: "active",
        spendingCapVnd: 1_000_000,
      },
      {
        userId: FIXTURE_IDS.users.lowestCapMember,
        displayName: "An",
        status: "active",
        spendingCapVnd: 800_000,
      },
      {
        userId: FIXTURE_IDS.users.fourthMember,
        displayName: "Thiện",
        status: "active",
        spendingCapVnd: 1_000_000,
      },
      {
        userId: FIXTURE_IDS.users.removedMember,
        displayName: "Cựu Thành Viên",
        status: "removed",
        spendingCapVnd: 1_000_000,
      },
    ],
  });

  store.trips.set(FIXTURE_IDS.trips.groupTrip, {
    tripId: FIXTURE_IDS.trips.groupTrip,
    mode: "group",
    ownerUserId: FIXTURE_IDS.users.creator,
    groupId: FIXTURE_IDS.groups.weekendGroup,
    individualBudgetVnd: null,
    startDate: "2026-11-28",
    endDate: "2026-11-30",
  });

  store.trips.set(FIXTURE_IDS.trips.individualTrip, {
    tripId: FIXTURE_IDS.trips.individualTrip,
    mode: "individual",
    ownerUserId: FIXTURE_IDS.users.creator,
    groupId: null,
    individualBudgetVnd: 500_000,
    startDate: "2026-11-28",
    endDate: "2026-12-10",
  });

  const groupDraftDays = [
    {
      date: "2026-11-28",
      stops: [
        {
          stopId: FIXTURE_IDS.stops.phoHoa,
          placeId: "plc_hcmc_014",
          startTime: "08:30",
          endTime: "09:30",
          selectedItems: [
            { menuItemId: "itm_phohoa_01", quantity: 4 },
            { menuItemId: "itm_phohoa_04", quantity: 4 },
          ],
        },
        {
          stopId: FIXTURE_IDS.stops.dinhDocLap,
          placeId: "plc_hcmc_003",
          startTime: "09:50",
          endTime: "11:30",
          selectedItems: [],
        },
        {
          stopId: FIXTURE_IDS.stops.cheoLeo,
          placeId: "plc_hcmc_042",
          startTime: "13:30",
          endTime: "15:00",
          selectedItems: [{ menuItemId: "itm_cheoleo_01", quantity: 4 }],
        },
      ],
    },
  ];

  store.plans.set(FIXTURE_IDS.plans.groupDraft, {
    planId: FIXTURE_IDS.plans.groupDraft,
    tripId: FIXTURE_IDS.trips.groupTrip,
    ownerUserId: FIXTURE_IDS.users.creator,
    createdByUserId: FIXTURE_IDS.users.creator,
    status: "draft",
    revision: 3,
    sharedWithGroup: false,
    sharedAt: null,
    savedAt: null,
    savedByUserId: null,
    note: null,
    shareUrl: null,
    draftDays: groupDraftDays,
    savedSnapshot: null,
  });

  store.plans.set(FIXTURE_IDS.plans.individualDraft, {
    planId: FIXTURE_IDS.plans.individualDraft,
    tripId: FIXTURE_IDS.trips.individualTrip,
    ownerUserId: FIXTURE_IDS.users.creator,
    createdByUserId: FIXTURE_IDS.users.creator,
    status: "draft",
    revision: 1,
    sharedWithGroup: false,
    sharedAt: null,
    savedAt: null,
    savedByUserId: null,
    note: null,
    shareUrl: null,
    draftDays: [
      {
        date: "2026-11-28",
        stops: [
          {
            stopId: FIXTURE_IDS.stops.phoHoa,
            placeId: "plc_hcmc_014",
            startTime: "08:30",
            endTime: "09:30",
            selectedItems: [
              { menuItemId: "itm_phohoa_01", quantity: 1 },
              { menuItemId: "itm_phohoa_04", quantity: 1 },
            ],
          },
          {
            stopId: FIXTURE_IDS.stops.dinhDocLap,
            placeId: "plc_hcmc_003",
            startTime: "09:50",
            endTime: "11:30",
            selectedItems: [],
          },
        ],
      },
    ],
    savedSnapshot: null,
  });

  store.plans.set(FIXTURE_IDS.plans.generatingDraft, {
    planId: FIXTURE_IDS.plans.generatingDraft,
    tripId: FIXTURE_IDS.trips.groupTrip,
    ownerUserId: FIXTURE_IDS.users.creator,
    createdByUserId: FIXTURE_IDS.users.creator,
    status: "generating",
    revision: 1,
    sharedWithGroup: false,
    sharedAt: null,
    savedAt: null,
    savedByUserId: null,
    note: null,
    shareUrl: null,
    draftDays: groupDraftDays,
    savedSnapshot: null,
  });

  store.plans.set(FIXTURE_IDS.plans.removedCreatorDraft, {
    planId: FIXTURE_IDS.plans.removedCreatorDraft,
    tripId: FIXTURE_IDS.trips.groupTrip,
    ownerUserId: FIXTURE_IDS.users.removedMember,
    createdByUserId: FIXTURE_IDS.users.removedMember,
    status: "draft",
    revision: 1,
    sharedWithGroup: false,
    sharedAt: null,
    savedAt: null,
    savedByUserId: null,
    note: null,
    shareUrl: null,
    draftDays: groupDraftDays,
    savedSnapshot: null,
  });

  return store;
}
