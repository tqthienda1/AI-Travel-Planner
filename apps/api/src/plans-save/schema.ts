import { z } from "zod";
import type { FieldError, SavePlanRequestBody } from "./types.js";

export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._-]{16,128}$/;
export const PLACE_ID_REGEX = /^[a-z0-9_-]{3,64}$/;
export const MENU_ITEM_ID_REGEX = /^[a-z0-9_-]{3,64}$/;
export const TIME_HHMM_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const DATE_YYYYMMDD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function hasForbiddenControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f && code !== 0x0a) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function parseTimeToMinutes(hhmm: string): number {
  const [hoursStr, minutesStr] = hhmm.split(":");
  return Number(hoursStr) * 60 + Number(minutesStr);
}

export function isValidGregorianDate(dateStr: string): boolean {
  if (!DATE_YYYYMMDD_REGEX.test(dateStr)) {
    return false;
  }
  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

const SelectedItemInputSchema = z
  .object({
    menuItemId: z.string().regex(MENU_ITEM_ID_REGEX, "menuItemId must match ^[a-z0-9_-]{3,64}$."),
    quantity: z.number().int().min(1).max(20),
    assignedMemberIds: z
      .array(
        z.string().regex(UUID_V4_REGEX, "assignedMemberIds elements must be lowercase UUIDv4."),
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();

const StopInputSchema = z
  .object({
    stopId: z.string().regex(UUID_V4_REGEX, "stopId must be a lowercase UUIDv4.").optional(),
    placeId: z.string().regex(PLACE_ID_REGEX, "placeId must match ^[a-z0-9_-]{3,64}$."),
    startTime: z.string().regex(TIME_HHMM_REGEX, "startTime must match HH:MM (24-hour)."),
    endTime: z.string().regex(TIME_HHMM_REGEX, "endTime must match HH:MM (24-hour)."),
    selectedItems: z.array(SelectedItemInputSchema).min(0).max(10),
  })
  .strict();

const DayScheduleInputSchema = z
  .object({
    date: z
      .string()
      .refine(isValidGregorianDate, "date must be a valid Gregorian ISO-8601 date YYYY-MM-DD."),
    stops: z.array(StopInputSchema).min(1).max(12),
  })
  .strict();

const EditsSchema = z
  .object({
    days: z.array(DayScheduleInputSchema).min(1).max(7),
  })
  .strict();

const SavePlanRequestBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1, "expectedRevision must be an integer >= 1."),
    shareWithGroup: z.boolean().optional(),
    note: z
      .string()
      .max(280, "note must be at most 280 UTF-16 code units.")
      .refine(
        (val) => !hasForbiddenControlChars(val),
        "note must not contain forbidden control characters.",
      )
      .nullable()
      .optional(),
    edits: EditsSchema.optional(),
  })
  .strict();

export function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toJsonPointer(path: (string | number)[]): string {
  if (path.length === 0) {
    return "";
  }
  return `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

export function validateSavePlanRequestBody(
  rawBody: unknown,
): { ok: true; data: SavePlanRequestBody } | { ok: false; errors: FieldError[] } {
  const parsed = SavePlanRequestBodySchema.safeParse(rawBody);
  const errors: FieldError[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) {
          errors.push({
            pointer: toJsonPointer([...issue.path, key]),
            code: "unrecognized_field",
            message: `Unrecognized field '${key}' is not allowed.`,
          });
        }
      } else {
        errors.push({
          pointer: toJsonPointer(issue.path),
          code: issue.code,
          message: issue.message,
        });
      }
    }
    return { ok: false, errors };
  }

  const data = parsed.data;

  if (data.edits) {
    const seenDates = new Set<string>();
    const seenStopIds = new Set<string>();
    let previousDate: string | null = null;

    data.edits.days.forEach((day, dayIndex) => {
      if (seenDates.has(day.date)) {
        errors.push({
          pointer: `/edits/days/${dayIndex}/date`,
          code: "duplicate_value",
          message: `Duplicate date '${day.date}' in edits.days.`,
        });
      }
      seenDates.add(day.date);

      if (previousDate !== null && day.date <= previousDate) {
        errors.push({
          pointer: `/edits/days/${dayIndex}/date`,
          code: "invalid_order",
          message: "edits.days dates must be strictly sorted in ascending chronological order.",
        });
      }
      previousDate = day.date;

      let previousStartMinutes: number | null = null;

      day.stops.forEach((stop, stopIndex) => {
        if (stop.stopId !== undefined) {
          if (seenStopIds.has(stop.stopId)) {
            errors.push({
              pointer: `/edits/days/${dayIndex}/stops/${stopIndex}/stopId`,
              code: "duplicate_value",
              message: `Duplicate stopId '${stop.stopId}' within request.`,
            });
          }
          seenStopIds.add(stop.stopId);
        }

        const startMin = parseTimeToMinutes(stop.startTime);
        const endMin = parseTimeToMinutes(stop.endTime);
        if (endMin <= startMin || endMin - startMin < 15) {
          errors.push({
            pointer: `/edits/days/${dayIndex}/stops/${stopIndex}/endTime`,
            code: "invalid_range",
            message: "endTime must be at least 15 minutes after startTime.",
          });
        }

        if (previousStartMinutes !== null && startMin < previousStartMinutes) {
          errors.push({
            pointer: `/edits/days/${dayIndex}/stops/${stopIndex}/startTime`,
            code: "invalid_order",
            message: "stops within a day must be ordered by ascending startTime.",
          });
        }
        previousStartMinutes = startMin;

        const seenMenuItems = new Set<string>();
        stop.selectedItems.forEach((item, itemIndex) => {
          if (seenMenuItems.has(item.menuItemId)) {
            errors.push({
              pointer: `/edits/days/${dayIndex}/stops/${stopIndex}/selectedItems/${itemIndex}/menuItemId`,
              code: "duplicate_value",
              message: `Duplicate menuItemId '${item.menuItemId}' within the same stop.`,
            });
          }
          seenMenuItems.add(item.menuItemId);

          if (item.assignedMemberIds) {
            const seenAssigned = new Set<string>();
            item.assignedMemberIds.forEach((memberId, memberIdx) => {
              if (seenAssigned.has(memberId)) {
                errors.push({
                  pointer: `/edits/days/${dayIndex}/stops/${stopIndex}/selectedItems/${itemIndex}/assignedMemberIds/${memberIdx}`,
                  code: "duplicate_value",
                  message: `Duplicate assignedMemberId '${memberId}'.`,
                });
              }
              seenAssigned.add(memberId);
            });
          }
        });
      });
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const normalized: SavePlanRequestBody = {
    expectedRevision: data.expectedRevision,
    ...(data.shareWithGroup !== undefined ? { shareWithGroup: data.shareWithGroup } : {}),
    ...(data.note !== undefined ? { note: data.note } : {}),
    ...(data.edits !== undefined
      ? {
          edits: {
            days: data.edits.days.map((day) => ({
              date: day.date,
              stops: day.stops.map((stop) => ({
                ...(stop.stopId !== undefined ? { stopId: stop.stopId } : {}),
                placeId: stop.placeId,
                startTime: stop.startTime,
                endTime: stop.endTime,
                selectedItems: stop.selectedItems.map((item) => ({
                  menuItemId: item.menuItemId,
                  quantity: item.quantity,
                  ...(item.assignedMemberIds !== undefined
                    ? { assignedMemberIds: item.assignedMemberIds }
                    : {}),
                })),
              })),
            })),
          },
        }
      : {}),
  };

  return { ok: true, data: normalized };
}
