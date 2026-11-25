export const CONTRACT_VERSION = "1.0.0" as const;
export const VALIDATOR_VERSION = "1.0.0" as const;
export const MAX_BODY_BYTES = 65_536;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const ATTRIBUTIONS = ["OpenStreetMap", "Wikimedia", "Open-Meteo"] as const;
export const CHECKS_RUN = [
  "existence",
  "opening_hours",
  "travel_time",
  "budget",
  "weather",
] as const;

export const PROBLEM_BASE_URI = "https://ai-travel-planner.local/problems/";

export const PROBLEM_TYPES = {
  invalidRequest: `${PROBLEM_BASE_URI}invalid-request`,
  invalidIdempotencyKey: `${PROBLEM_BASE_URI}invalid-idempotency-key`,
  unauthorized: `${PROBLEM_BASE_URI}unauthorized`,
  forbiddenRole: `${PROBLEM_BASE_URI}forbidden-role`,
  ownershipViolation: `${PROBLEM_BASE_URI}ownership-violation`,
  planNotFound: `${PROBLEM_BASE_URI}plan-not-found`,
  planStateConflict: `${PROBLEM_BASE_URI}plan-state-conflict`,
  revisionConflict: `${PROBLEM_BASE_URI}revision-conflict`,
  idempotencyInProgress: `${PROBLEM_BASE_URI}idempotency-in-progress`,
  payloadTooLarge: `${PROBLEM_BASE_URI}payload-too-large`,
  unsupportedMediaType: `${PROBLEM_BASE_URI}unsupported-media-type`,
  idempotencyKeyReused: `${PROBLEM_BASE_URI}idempotency-key-reused`,
  planValidationFailed: `${PROBLEM_BASE_URI}plan-validation-failed`,
  rateLimited: `${PROBLEM_BASE_URI}rate-limited`,
  internalError: `${PROBLEM_BASE_URI}internal-error`,
  validatorDependencyUnavailable: `${PROBLEM_BASE_URI}validator-dependency-unavailable`,
} as const;

export type UserRole = "member" | "business" | "admin";
export type TripMode = "individual" | "group";
export type PlanStatus = "generating" | "draft" | "saved" | "archived";
export type MembershipStatus = "active" | "invited" | "left" | "removed";
export type Weekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export interface AuthenticatedCaller {
  userId: string;
  role: UserRole;
  exp: number;
  jti?: string;
}

export interface SelectedItemInput {
  menuItemId: string;
  quantity: number;
  assignedMemberIds?: string[];
}

export interface StopInput {
  stopId?: string;
  placeId: string;
  startTime: string;
  endTime: string;
  selectedItems: SelectedItemInput[];
}

export interface DayScheduleInput {
  date: string;
  stops: StopInput[];
}

export interface SavePlanRequestBody {
  expectedRevision: number;
  shareWithGroup?: boolean;
  note?: string | null;
  edits?: {
    days: DayScheduleInput[];
  };
}

export interface FieldError {
  pointer: string;
  code: string;
  message: string;
}

export type PlanViolationCode =
  | "PLACE_NOT_FOUND"
  | "MENU_ITEM_NOT_FOUND"
  | "OUTSIDE_OPENING_HOURS"
  | "TRAVEL_TIME_EXCEEDED"
  | "BUDGET_EXCEEDED"
  | "RAIN_RISK_OUTDOOR";

export interface PlanViolation {
  code: PlanViolationCode;
  dayDate: string | null;
  stopId: string | null;
  placeId: string | null;
  message: string;
  details: Record<string, unknown>;
}

export interface ValidationSummary {
  passed: true;
  validatedAt: string;
  validatorVersion: string;
  checksRun: readonly string[];
}

export interface MemberBudget {
  userId: string;
  estimatedVnd: number;
  spendingCapVnd: number;
  remainingVnd: number;
}

export interface BudgetSummary {
  currency: "VND";
  mode: TripMode;
  totalEstimatedVnd: number;
  groupBudgetLimitVnd: number | null;
  lowestMemberCapVnd: number | null;
  memberBreakdown: MemberBudget[];
}

export interface SavedSelectedItem {
  menuItemId: string;
  itemName: string;
  unitPriceVnd: number;
  quantity: number;
  lineTotalVnd: number;
  assignedMemberIds: string[];
}

export interface SavedStop {
  stopId: string;
  placeId: string;
  placeName: string;
  district: string;
  isOutdoor: boolean;
  startTime: string;
  endTime: string;
  openingHours: string;
  travelMinutesFromPrevious: number | null;
  rainProbabilityPct: number | null;
  ticketPriceVnd: number;
  ticketSubtotalVnd: number;
  menuSubtotalVnd: number;
  stopTotalVnd: number;
  selectedItems: SavedSelectedItem[];
}

export interface SavedDaySchedule {
  date: string;
  dayTotalVnd: number;
  stops: SavedStop[];
}

export interface SavedPlanResponse {
  planId: string;
  tripId: string;
  groupId: string | null;
  status: "saved";
  revision: number;
  sharedWithGroup: boolean;
  sharedAt: string | null;
  savedAt: string;
  savedByUserId: string;
  note: string | null;
  shareUrl: string | null;
  validation: ValidationSummary;
  budgetSummary: BudgetSummary;
  days: SavedDaySchedule[];
  attributions: readonly string[];
}

export interface MenuItemRecord {
  menuItemId: string;
  itemName: string;
  unitPriceVnd: number;
}

export interface CheckedPlaceRecord {
  placeId: string;
  placeName: string;
  district: string;
  isOutdoor: boolean;
  ticketPriceVnd: number;
  /** `null` simulates a place with unverified/missing opening hours. */
  openingHoursByWeekday: Record<Weekday, string> | null;
  /** `null` simulates a place with unverified/missing menu data. */
  menuItems: MenuItemRecord[] | null;
  closedDates?: string[];
}

export interface CheckedDataset {
  places: Map<string, CheckedPlaceRecord>;
  /** Key format: `${fromPlaceId}->${toPlaceId}` -> motorbike minutes */
  travelMinutesMatrix: Map<string, number>;
  /** Key format: `YYYY-MM-DD` -> hourly map `HH:00` -> rain probability 0..100 */
  hourlyRainForecast: Map<string, Record<string, number>>;
  publicHolidays: Set<string>;
}

export interface GroupMemberRecord {
  userId: string;
  displayName: string;
  status: MembershipStatus;
  spendingCapVnd: number;
}

export interface GroupRecord {
  groupId: string;
  groupBudgetLimitVnd: number;
  members: GroupMemberRecord[];
}

export interface TripRecord {
  tripId: string;
  mode: TripMode;
  ownerUserId: string;
  groupId: string | null;
  individualBudgetVnd: number | null;
  startDate: string;
  endDate: string;
}

export interface PlanRecord {
  planId: string;
  tripId: string;
  ownerUserId: string;
  createdByUserId: string;
  status: PlanStatus;
  revision: number;
  sharedWithGroup: boolean;
  sharedAt: string | null;
  savedAt: string | null;
  savedByUserId: string | null;
  note: string | null;
  shareUrl: string | null;
  draftDays: DayScheduleInput[];
  savedSnapshot: SavedPlanResponse | null;
}

export interface ShareEvent {
  planId: string;
  groupId: string;
  revision: number;
  sharedAt: string;
  sharedByUserId: string;
}

export interface IdempotencyRecord {
  status: "in_progress" | "completed";
  payloadHash: string;
  completedAtMs: number;
  responseStatusCode?: number;
  responseBody?: Record<string, unknown>;
  responseContentType?: string;
  etag?: string;
}

export type ValidatorDependencyName =
  | "checked-places-dataset"
  | "motorbike-travel-matrix"
  | "open-meteo-forecast";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface PlansSaveRuntimeOptions {
  store?: import("./store.js").PlansSaveStore;
  dataset?: CheckedDataset;
  signingKey?: string;
  now?: () => Date;
  unavailableDependency?: () => ValidatorDependencyName | null;
  checkRateLimit?: (userId: string) => RateLimitDecision;
  injectUnexpectedError?: () => Error | null;
  beforePersistHook?: () => Promise<void> | void;
}
