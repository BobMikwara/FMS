import { localBucketKeyInTimeZone, localDateKeyInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { addDays, dateKeysBetween, daysBetween, mondayOf, parseDateKey, startOfLocalDay } from "./calendar-dates";

/**
 * Fuel usage for one tank over a chosen period.
 *
 * "Usage" is the sum of the tank's recorded `consumption` movements, which is the
 * same definition behind the "Fuel consumption / tank outflow (today)" figure on
 * the tank page, so the two always agree. Refills are not usage.
 *
 * Everything here is pure: it turns a range request plus raw movements into
 * buckets and metrics, in the tank's own time zone. Nothing is estimated and no
 * period that has not happened yet is ever shown.
 */

export type UsagePreset = "today" | "week" | "month" | "custom";
export type UsageInterval = "hour" | "day" | "week";

export const USAGE_PRESETS: readonly { value: UsagePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom Date" },
];

export const MAX_USAGE_RANGE_DAYS = 366;
/** A custom range this short or shorter is charted hour by hour. */
const HOURLY_MAX_SPAN_DAYS = 2;
/** Longer than this and a custom range is charted week by week so the bars stay readable. */
const DAILY_MAX_SPAN_DAYS = 62;

const HOUR_MS = 3_600_000;

/* -------------------------------------------------------------------------- */
/* Range resolution                                                            */
/* -------------------------------------------------------------------------- */

export interface UsageRangeRequest {
  preset: UsagePreset;
  /** Local `YYYY-MM-DD`; used by `custom` only. */
  start?: string | null;
  end?: string | null;
}

export interface UsageRange {
  preset: UsagePreset;
  timeZone: string;
  /** First and last local calendar day covered, inclusive. `endDate` is never after today. */
  startDate: string;
  endDate: string;
  todayDate: string;
  /** Start of `startDate` and the earlier of "now" and the end of `endDate`, as ISO instants. */
  from: string;
  to: string;
  interval: UsageInterval;
}

export type UsageRangeResult = { ok: true; range: UsageRange } | { ok: false; error: string };

export function parseUsagePreset(value: string | null | undefined): UsagePreset | null {
  return USAGE_PRESETS.some((preset) => preset.value === value) ? (value as UsagePreset) : null;
}

export function intervalForSpan(spanDays: number): UsageInterval {
  if (spanDays <= HOURLY_MAX_SPAN_DAYS) return "hour";
  if (spanDays <= DAILY_MAX_SPAN_DAYS) return "day";
  return "week";
}

export function todayDateKey(now: Date, timeZone: string): string {
  return localDateKeyInTimeZone(now, normalizeTimeZone(timeZone));
}

/** The local calendar date of an instant in `timeZone`, as `YYYY-MM-DD`. */
export function localDateKey(instant: string | Date, timeZone: string): string {
  return localDateKeyInTimeZone(instant, normalizeTimeZone(timeZone));
}

export function resolveUsageRange(request: UsageRangeRequest, now: Date, timeZone: string): UsageRangeResult {
  const zone = normalizeTimeZone(timeZone);
  const today = localDateKeyInTimeZone(now, zone);
  const fail = (error: string): UsageRangeResult => ({ ok: false, error });

  let startDate: string;
  let endDate = today;
  switch (request.preset) {
    case "today":
      startDate = today;
      break;
    case "week":
      startDate = mondayOf(today);
      break;
    case "month":
      startDate = `${today.slice(0, 7)}-01`;
      break;
    case "custom": {
      if (!request.start || !request.end) return fail("Choose both a start date and an end date.");
      if (!parseDateKey(request.start) || !parseDateKey(request.end)) return fail("Enter valid dates for the start and the end.");
      if (request.end < request.start) return fail("The end date must be on or after the start date.");
      if (request.start > today) return fail("The start date cannot be in the future.");
      startDate = request.start;
      endDate = request.end < today ? request.end : today;
      break;
    }
    default:
      return fail("Unknown usage period.");
  }

  const spanDays = daysBetween(startDate, endDate) + 1;
  if (spanDays > MAX_USAGE_RANGE_DAYS) return fail(`Choose a period of ${MAX_USAGE_RANGE_DAYS} days or fewer.`);

  const interval: UsageInterval =
    request.preset === "today" ? "hour" : request.preset === "custom" ? intervalForSpan(spanDays) : "day";
  const endExclusive = startOfLocalDay(addDays(endDate, 1), zone).getTime();
  return {
    ok: true,
    range: {
      preset: request.preset,
      timeZone: zone,
      startDate,
      endDate,
      todayDate: today,
      from: startOfLocalDay(startDate, zone).toISOString(),
      to: new Date(Math.min(now.getTime(), endExclusive - 1)).toISOString(),
      interval,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

export interface UsageEvent {
  ts: string;
  volume: number;
}

export interface UsageBucket {
  /** `YYYY-MM-DDTHH:00` (hour), `YYYY-MM-DD` (day) or the first covered date of a week. */
  key: string;
  /** Last local date covered. Equals the bucket's date for hourly and daily buckets. */
  endDate: string;
  volume: number;
  events: number;
  /** True while the bucket still contains the current moment. */
  inProgress: boolean;
}

export interface UsageMetrics {
  /** Local days in the period that the tank has data for, up to and including today. */
  daysRepresented: number;
  /** Days that are over and have full coverage. Only these feed the average and the extremes. */
  completeDays: number;
  includesToday: boolean;
  /** True when the first day of data began part-way through that day. */
  startsPartway: boolean;
  averagePerDay: number | null;
  highest: { date: string; volume: number } | null;
  lowest: { date: string; volume: number } | null;
}

export interface UsageReport {
  timeZone: string;
  preset: UsagePreset;
  /** The period actually covered (after limiting to elapsed days and to the tank's history). */
  startDate: string;
  endDate: string;
  /** The first day that was asked for, which can be earlier than `startDate`. */
  requestedStartDate: string;
  from: string;
  to: string;
  interval: UsageInterval;
  buckets: UsageBucket[];
  totals: { volume: number; events: number };
  metrics: UsageMetrics;
  /** The earliest reading or movement recorded for the tank. */
  dataStart: string | null;
  /** False when the tank has no history at all inside the requested period. */
  hasData: boolean;
}

interface Totals {
  volume: number;
  events: number;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function buildUsageReport(input: {
  range: UsageRange;
  events: readonly UsageEvent[];
  dataStart: string | null;
  now?: Date;
}): UsageReport {
  const { range, events, dataStart } = input;
  const now = input.now ?? new Date();
  const zone = range.timeZone;
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);

  const inRange: { ms: number; volume: number }[] = [];
  for (const event of events) {
    const ms = Date.parse(event.ts);
    const volume = Number(event.volume);
    if (!Number.isFinite(ms) || !Number.isFinite(volume) || ms < fromMs || ms > toMs) continue;
    inRange.push({ ms, volume });
  }

  // The tank's history begins at its first reading or movement. Nothing earlier is shown or averaged.
  const knownStarts = [dataStart ? Date.parse(dataStart) : NaN, ...inRange.map((event) => event.ms)].filter(Number.isFinite);
  const historyStartMs = knownStarts.length > 0 ? Math.min(...knownStarts) : null;
  const hasData = historyStartMs !== null && historyStartMs <= toMs;
  const historyStartDate = hasData ? localDateKeyInTimeZone(new Date(historyStartMs), zone) : null;
  const firstDate = historyStartDate && historyStartDate > range.startDate ? historyStartDate : range.startDate;
  const coveredDates = hasData ? dateKeysBetween(firstDate, range.endDate) : [];

  const perDay = new Map<string, Totals>();
  for (const event of inRange) {
    const date = localDateKeyInTimeZone(new Date(event.ms), zone);
    const day = perDay.get(date) ?? { volume: 0, events: 0 };
    day.volume += event.volume;
    day.events += 1;
    perDay.set(date, day);
  }

  const days = coveredDates.map((date) => {
    const day = perDay.get(date) ?? { volume: 0, events: 0 };
    const over = date !== range.todayDate;
    const fullCoverage = historyStartMs !== null && historyStartMs <= startOfLocalDay(date, zone).getTime();
    return { date, volume: day.volume, events: day.events, complete: over && fullCoverage };
  });
  const complete = days.filter((day) => day.complete);
  const metrics: UsageMetrics = {
    daysRepresented: days.length,
    completeDays: complete.length,
    includesToday: days.some((day) => day.date === range.todayDate),
    startsPartway: days.length > 0 && !days[0].complete && days[0].date !== range.todayDate,
    averagePerDay: complete.length > 0 ? sum(complete.map((day) => day.volume)) / complete.length : null,
    highest: null,
    lowest: null,
  };
  if (complete.length >= 2) {
    const highest = complete.reduce((best, day) => (day.volume > best.volume ? day : best));
    const lowest = complete.reduce((best, day) => (day.volume < best.volume ? day : best));
    metrics.highest = { date: highest.date, volume: highest.volume };
    metrics.lowest = { date: lowest.date, volume: lowest.volume };
  }

  let buckets: UsageBucket[] = [];
  if (hasData && range.interval === "hour") {
    const perHour = new Map<string, Totals>();
    for (const event of inRange) {
      const key = localBucketKeyInTimeZone(new Date(event.ms), "hour", zone);
      const hour = perHour.get(key) ?? { volume: 0, events: 0 };
      hour.volume += event.volume;
      hour.events += 1;
      perHour.set(key, hour);
    }
    const seen = new Set<string>();
    for (let at = fromMs; at <= toMs; at += HOUR_MS) {
      if (at + HOUR_MS <= (historyStartMs as number)) continue;
      const key = localBucketKeyInTimeZone(new Date(at), "hour", zone);
      if (seen.has(key)) continue;
      seen.add(key);
      const hour = perHour.get(key) ?? { volume: 0, events: 0 };
      buckets.push({
        key,
        endDate: key.slice(0, 10),
        volume: hour.volume,
        events: hour.events,
        inProgress: at <= now.getTime() && now.getTime() < at + HOUR_MS,
      });
    }
  } else if (hasData && range.interval === "day") {
    buckets = days.map((day) => ({
      key: day.date,
      endDate: day.date,
      volume: day.volume,
      events: day.events,
      inProgress: day.date === range.todayDate,
    }));
  } else if (hasData) {
    const weeks = new Map<string, UsageBucket>();
    for (const day of days) {
      const weekKey = mondayOf(day.date);
      const week = weeks.get(weekKey);
      if (week) {
        week.endDate = day.date;
        week.volume += day.volume;
        week.events += day.events;
        week.inProgress = week.inProgress || day.date === range.todayDate;
      } else {
        weeks.set(weekKey, {
          key: day.date,
          endDate: day.date,
          volume: day.volume,
          events: day.events,
          inProgress: day.date === range.todayDate,
        });
      }
    }
    buckets = [...weeks.values()];
  }

  return {
    timeZone: zone,
    preset: range.preset,
    startDate: firstDate,
    endDate: range.endDate,
    requestedStartDate: range.startDate,
    from: range.from,
    to: range.to,
    interval: range.interval,
    buckets,
    totals: { volume: sum(inRange.map((event) => event.volume)), events: inRange.length },
    metrics,
    dataStart: historyStartMs === null ? null : new Date(historyStartMs).toISOString(),
    hasData,
  };
}
