import { randomUUID } from "node:crypto";
import { parseTimeToMinutes } from "./schema.js";
import type {
  BudgetSummary,
  CheckedDataset,
  DayScheduleInput,
  GroupMemberRecord,
  GroupRecord,
  MemberBudget,
  PlanViolation,
  SavedDaySchedule,
  SavedSelectedItem,
  SavedStop,
  TripRecord,
  ValidationSummary,
  Weekday,
} from "./types.js";
import { CHECKS_RUN, VALIDATOR_VERSION } from "./types.js";

const WEEKDAYS: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const RAIN_THRESHOLD_PCT = 60;
const HCMC_OFFSET_MS = 7 * 60 * 60 * 1000;
const FORECAST_HORIZON_DAYS = 7;

export function getWeekdayForDate(dateStr: string): Weekday {
  const [yStr, mStr, dStr] = dateStr.split("-");
  const dt = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  return WEEKDAYS[dt.getUTCDay()] ?? "sunday";
}

function getHcmcDateString(now: Date): string {
  const local = new Date(now.getTime() + HCMC_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  const [fy, fm, fd] = fromDateStr.split("-").map(Number);
  const [ty, tm, td] = toDateStr.split("-").map(Number);
  const fromUtc = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const toUtc = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

function splitAmountVnd(
  amountVnd: number,
  sortedUserIds: readonly string[],
  totalsByUser: Map<string, number>,
): void {
  const k = sortedUserIds.length;
  if (k === 0 || amountVnd === 0) {
    return;
  }
  const baseShare = Math.floor(amountVnd / k);
  const remainder = amountVnd % k;
  for (let i = 0; i < k; i += 1) {
    const uid = sortedUserIds[i];
    if (!uid) continue;
    const extra = i < remainder ? 1 : 0;
    totalsByUser.set(uid, (totalsByUser.get(uid) ?? 0) + baseShare + extra);
  }
}

function getRainSnapshotForStop(
  date: string,
  startMin: number,
  endMin: number,
  now: Date,
  dataset: CheckedDataset,
): { maxPct: number | null; worstHour: string | null } {
  const todayHcmc = getHcmcDateString(now);
  const dayOffset = diffCalendarDays(todayHcmc, date);
  if (dayOffset > FORECAST_HORIZON_DAYS) {
    return { maxPct: null, worstHour: null };
  }

  const hourly = dataset.hourlyRainForecast.get(date);
  if (!hourly) {
    return { maxPct: null, worstHour: null };
  }

  let maxPct: number | null = null;
  let worstHour: string | null = null;

  for (let hour = 0; hour < 24; hour += 1) {
    const hourStart = hour * 60;
    const hourEnd = (hour + 1) * 60;
    if (hourStart < endMin && hourEnd > startMin) {
      const hourKey = `${String(hour).padStart(2, "0")}:00`;
      const pct = hourly[hourKey];
      if (pct !== undefined && (maxPct === null || pct > maxPct)) {
        maxPct = pct;
        worstHour = hourKey;
      }
    }
  }

  return { maxPct, worstHour };
}

export interface ValidatePlanInput {
  trip: TripRecord;
  group: GroupRecord | null;
  days: DayScheduleInput[];
  dataset: CheckedDataset;
  now: Date;
}

export interface ValidatePlanResult {
  violations: PlanViolation[];
  days: SavedDaySchedule[];
  budgetSummary: BudgetSummary;
  validation: ValidationSummary;
}

export function computeCostAndValidatePlan(input: ValidatePlanInput): ValidatePlanResult {
  const { trip, group, days, dataset, now } = input;
  const violations: PlanViolation[] = [];

  const activeParticipants: GroupMemberRecord[] =
    trip.mode === "group" && group
      ? group.members
          .filter((member) => member.status === "active")
          .sort((a, b) => a.userId.localeCompare(b.userId))
      : [
          {
            userId: trip.ownerUserId,
            displayName: "Owner",
            status: "active",
            spendingCapVnd: trip.individualBudgetVnd ?? 0,
          },
        ];

  const participantIds = activeParticipants.map((m) => m.userId);
  const estimatedByUser = new Map<string, number>();
  for (const uid of participantIds) {
    estimatedByUser.set(uid, 0);
  }

  const resolvedDays: SavedDaySchedule[] = [];
  let totalEstimatedVnd = 0;

  for (const day of days) {
    const weekday = getWeekdayForDate(day.date);
    const savedStops: SavedStop[] = [];
    let dayTotalVnd = 0;

    for (let stopIdx = 0; stopIdx < day.stops.length; stopIdx += 1) {
      const stop = day.stops[stopIdx];
      if (!stop) continue;

      const resolvedStopId = stop.stopId ?? randomUUID();
      const startMin = parseTimeToMinutes(stop.startTime);
      const endMin = parseTimeToMinutes(stop.endTime);

      // Rule 3: Precomputed motorbike travel time between consecutive stops
      let travelMinutesFromPrevious: number | null = null;
      if (stopIdx > 0) {
        const prevStop = day.stops[stopIdx - 1];
        if (prevStop) {
          const prevEndMin = parseTimeToMinutes(prevStop.endTime);
          const availableGapMinutes = startMin - prevEndMin;
          const matrixKey = `${prevStop.placeId}->${stop.placeId}`;
          const requiredTravelMinutes =
            prevStop.placeId === stop.placeId
              ? 0
              : (dataset.travelMinutesMatrix.get(matrixKey) ?? 15);
          travelMinutesFromPrevious = requiredTravelMinutes;

          if (availableGapMinutes < requiredTravelMinutes) {
            violations.push({
              code: "TRAVEL_TIME_EXCEEDED",
              dayDate: day.date,
              stopId: resolvedStopId,
              placeId: stop.placeId,
              message: `Motorbike travel from ${prevStop.placeId} to ${stop.placeId} requires ${requiredTravelMinutes} minutes, but only ${availableGapMinutes} minutes are available.`,
              details: {
                fromPlaceId: prevStop.placeId,
                toPlaceId: stop.placeId,
                requiredTravelMinutes,
                availableGapMinutes,
              },
            });
          }
        }
      }

      // Rule 1: Checked dataset existence (place + hours + menu)
      const place = dataset.places.get(stop.placeId);
      if (!place) {
        violations.push({
          code: "PLACE_NOT_FOUND",
          dayDate: day.date,
          stopId: resolvedStopId,
          placeId: stop.placeId,
          message: `Place '${stop.placeId}' does not exist in the checked HCMC dataset.`,
          details: {
            placeId: stop.placeId,
            reason: "unknown_place",
          },
        });
        continue;
      }

      if (place.openingHoursByWeekday === null) {
        violations.push({
          code: "PLACE_NOT_FOUND",
          dayDate: day.date,
          stopId: resolvedStopId,
          placeId: stop.placeId,
          message: `Place '${place.placeName}' is missing verified opening hours.`,
          details: {
            placeId: stop.placeId,
            reason: "missing_hours",
          },
        });
      }

      if (place.menuItems === null) {
        violations.push({
          code: "PLACE_NOT_FOUND",
          dayDate: day.date,
          stopId: resolvedStopId,
          placeId: stop.placeId,
          message: `Place '${place.placeName}' is missing verified menu data.`,
          details: {
            placeId: stop.placeId,
            reason: "missing_menu",
          },
        });
      }

      // Rule 2: Opening hours & public holiday closure
      let openingHoursSnapshot = "CLOSED";
      if (place.openingHoursByWeekday !== null) {
        const isHolidayClosed =
          place.closedDates?.includes(day.date) ||
          (dataset.publicHolidays.has(day.date) && place.ticketPriceVnd > 0);
        const weekdayWindow = isHolidayClosed ? "CLOSED" : place.openingHoursByWeekday[weekday];
        openingHoursSnapshot = weekdayWindow;

        if (weekdayWindow === "CLOSED") {
          violations.push({
            code: "OUTSIDE_OPENING_HOURS",
            dayDate: day.date,
            stopId: resolvedStopId,
            placeId: stop.placeId,
            message: `${place.placeName} is closed on ${day.date} (${weekday}).`,
            details: {
              requestedStart: stop.startTime,
              requestedEnd: stop.endTime,
              openingHours: "CLOSED",
              weekday,
            },
          });
        } else {
          const [openStr, closeStr] = weekdayWindow.split("-");
          if (openStr && closeStr) {
            const openMin = parseTimeToMinutes(openStr);
            const closeMin = parseTimeToMinutes(closeStr);
            if (startMin < openMin || endMin > closeMin) {
              violations.push({
                code: "OUTSIDE_OPENING_HOURS",
                dayDate: day.date,
                stopId: resolvedStopId,
                placeId: stop.placeId,
                message: `${place.placeName} is open ${weekdayWindow} on ${weekday}; stop is scheduled ${stop.startTime}-${stop.endTime}.`,
                details: {
                  requestedStart: stop.startTime,
                  requestedEnd: stop.endTime,
                  openingHours: weekdayWindow,
                  weekday,
                },
              });
            }
          }
        }
      }

      // Rule 5: Weather check for outdoor stops (> 60% rain within 7-day horizon)
      const { maxPct: rainProbabilityPct, worstHour } = getRainSnapshotForStop(
        day.date,
        startMin,
        endMin,
        now,
        dataset,
      );

      if (
        place.isOutdoor &&
        rainProbabilityPct !== null &&
        rainProbabilityPct > RAIN_THRESHOLD_PCT
      ) {
        violations.push({
          code: "RAIN_RISK_OUTDOOR",
          dayDate: day.date,
          stopId: resolvedStopId,
          placeId: stop.placeId,
          message: `Outdoor stop ${place.placeName} is scheduled during a ${rainProbabilityPct}% chance of rain (threshold: ${RAIN_THRESHOLD_PCT}%).`,
          details: {
            rainProbabilityPct,
            thresholdPct: RAIN_THRESHOLD_PCT,
            forecastHour: worstHour ?? `${stop.startTime.slice(0, 2)}:00`,
          },
        });
      }

      // Rule 1b + Rule 4: Menu items existence and deterministic VND cost computation
      const menuById = new Map((place.menuItems ?? []).map((item) => [item.menuItemId, item]));
      const ticketSubtotalVnd = place.ticketPriceVnd * participantIds.length;
      splitAmountVnd(ticketSubtotalVnd, participantIds, estimatedByUser);

      let menuSubtotalVnd = 0;
      const savedSelectedItems: SavedSelectedItem[] = [];

      for (const selected of stop.selectedItems) {
        const menuItem = menuById.get(selected.menuItemId);
        if (!menuItem) {
          violations.push({
            code: "MENU_ITEM_NOT_FOUND",
            dayDate: day.date,
            stopId: resolvedStopId,
            placeId: stop.placeId,
            message: `Menu item '${selected.menuItemId}' does not exist for place '${stop.placeId}'.`,
            details: {
              placeId: stop.placeId,
              menuItemId: selected.menuItemId,
            },
          });
          continue;
        }

        const lineTotalVnd = menuItem.unitPriceVnd * selected.quantity;
        const assignedSorted = [...(selected.assignedMemberIds ?? participantIds)].sort((a, b) =>
          a.localeCompare(b),
        );
        splitAmountVnd(lineTotalVnd, assignedSorted, estimatedByUser);
        menuSubtotalVnd += lineTotalVnd;

        savedSelectedItems.push({
          menuItemId: menuItem.menuItemId,
          itemName: menuItem.itemName,
          unitPriceVnd: menuItem.unitPriceVnd,
          quantity: selected.quantity,
          lineTotalVnd,
          assignedMemberIds: assignedSorted,
        });
      }

      const stopTotalVnd = ticketSubtotalVnd + menuSubtotalVnd;
      dayTotalVnd += stopTotalVnd;

      savedStops.push({
        stopId: resolvedStopId,
        placeId: place.placeId,
        placeName: place.placeName,
        district: place.district,
        isOutdoor: place.isOutdoor,
        startTime: stop.startTime,
        endTime: stop.endTime,
        openingHours: openingHoursSnapshot,
        travelMinutesFromPrevious,
        rainProbabilityPct,
        ticketPriceVnd: place.ticketPriceVnd,
        ticketSubtotalVnd,
        menuSubtotalVnd,
        stopTotalVnd,
        selectedItems: savedSelectedItems,
      });
    }

    totalEstimatedVnd += dayTotalVnd;
    resolvedDays.push({
      date: day.date,
      dayTotalVnd,
      stops: savedStops,
    });
  }

  // Rule 4: Budget invariants
  const lowestMemberCapVnd =
    trip.mode === "group" && activeParticipants.length > 0
      ? Math.min(...activeParticipants.map((member) => member.spendingCapVnd))
      : null;
  const groupBudgetLimitVnd = trip.mode === "group" && group ? group.groupBudgetLimitVnd : null;

  const memberBreakdown: MemberBudget[] = activeParticipants.map((member) => {
    const estimatedVnd = estimatedByUser.get(member.userId) ?? 0;
    return {
      userId: member.userId,
      estimatedVnd,
      spendingCapVnd: member.spendingCapVnd,
      remainingVnd: member.spendingCapVnd - estimatedVnd,
    };
  });

  if (trip.mode === "individual") {
    const solo = memberBreakdown[0];
    if (solo && solo.estimatedVnd > solo.spendingCapVnd) {
      const excessVnd = solo.estimatedVnd - solo.spendingCapVnd;
      violations.push({
        code: "BUDGET_EXCEEDED",
        dayDate: null,
        stopId: null,
        placeId: null,
        message: `Estimated spending of ${solo.estimatedVnd} VND exceeds individual budget of ${solo.spendingCapVnd} VND by ${excessVnd} VND.`,
        details: {
          scope: "individual",
          userId: solo.userId,
          estimatedVnd: solo.estimatedVnd,
          limitVnd: solo.spendingCapVnd,
          excessVnd,
        },
      });
    }
  } else {
    if (groupBudgetLimitVnd !== null && totalEstimatedVnd > groupBudgetLimitVnd) {
      const excessVnd = totalEstimatedVnd - groupBudgetLimitVnd;
      violations.push({
        code: "BUDGET_EXCEEDED",
        dayDate: null,
        stopId: null,
        placeId: null,
        message: `Group total spending of ${totalEstimatedVnd} VND exceeds group budget limit of ${groupBudgetLimitVnd} VND by ${excessVnd} VND.`,
        details: {
          scope: "group_total",
          userId: null,
          estimatedVnd: totalEstimatedVnd,
          limitVnd: groupBudgetLimitVnd,
          excessVnd,
        },
      });
    }

    for (const member of memberBreakdown) {
      if (member.estimatedVnd > member.spendingCapVnd) {
        const excessVnd = member.estimatedVnd - member.spendingCapVnd;
        const scope =
          lowestMemberCapVnd !== null && member.spendingCapVnd === lowestMemberCapVnd
            ? "lowest_group_cap"
            : "member_cap";
        violations.push({
          code: "BUDGET_EXCEEDED",
          dayDate: null,
          stopId: null,
          placeId: null,
          message: `Estimated spending of ${member.estimatedVnd} VND exceeds member ${member.userId}'s cap of ${member.spendingCapVnd} VND by ${excessVnd} VND.`,
          details: {
            scope,
            userId: member.userId,
            estimatedVnd: member.estimatedVnd,
            limitVnd: member.spendingCapVnd,
            excessVnd,
          },
        });
      } else if (lowestMemberCapVnd !== null && member.estimatedVnd > lowestMemberCapVnd) {
        const excessVnd = member.estimatedVnd - lowestMemberCapVnd;
        violations.push({
          code: "BUDGET_EXCEEDED",
          dayDate: null,
          stopId: null,
          placeId: null,
          message: `Estimated spending of ${member.estimatedVnd} VND for member ${member.userId} exceeds the group's lowest spending cap of ${lowestMemberCapVnd} VND by ${excessVnd} VND.`,
          details: {
            scope: "lowest_group_cap",
            userId: member.userId,
            estimatedVnd: member.estimatedVnd,
            limitVnd: lowestMemberCapVnd,
            excessVnd,
          },
        });
      }
    }
  }

  const budgetSummary: BudgetSummary = {
    currency: "VND",
    mode: trip.mode,
    totalEstimatedVnd,
    groupBudgetLimitVnd,
    lowestMemberCapVnd,
    memberBreakdown,
  };

  const validation: ValidationSummary = {
    passed: true,
    validatedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    validatorVersion: VALIDATOR_VERSION,
    checksRun: CHECKS_RUN,
  };

  return {
    violations,
    days: resolvedDays,
    budgetSummary,
    validation,
  };
}
