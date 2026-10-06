import { dayStartInTimeZone, localDateKeyInTimeZone } from "@/server/services/time-zone";

/**
 * Calendar dates written as `YYYY-MM-DD`.
 *
 * These are plain calendar days with no time of day, so adding days, finding the
 * Monday of a week or listing the days between two dates never depends on a time
 * zone. The one exception is `startOfLocalDay`, which says when a calendar day
 * begins in a given zone.
 */

const DAY_MS = 86_400_000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const pad = (value: number) => String(value).padStart(2, "0");

export function parseDateKey(key: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = key ? DATE_KEY.exec(key) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

function dateKeyToMs(key: string): number {
  const parts = parseDateKey(key);
  if (!parts) throw new RangeError(`Invalid calendar date: ${key}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function msToDateKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key: string, days: number): string {
  return msToDateKey(dateKeyToMs(key) + days * DAY_MS);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateKeyToMs(b) - dateKeyToMs(a)) / DAY_MS);
}

export function weekdayOf(key: string): number {
  return new Date(dateKeyToMs(key)).getUTCDay();
}

/** The Monday on or before `key`. */
export function mondayOf(key: string): string {
  return addDays(key, -((weekdayOf(key) + 6) % 7));
}

export function dateKeysBetween(start: string, end: string): string[] {
  const keys: string[] = [];
  for (let key = start; key <= end; key = addDays(key, 1)) keys.push(key);
  return keys;
}

/** The instant a local calendar day begins in `timeZone`. */
export function startOfLocalDay(dateKey: string, timeZone: string): Date {
  const parts = parseDateKey(dateKey);
  if (!parts) throw new RangeError(`Invalid calendar date: ${dateKey}`);
  // Anchor on midday UTC, then nudge until the anchor falls on the wanted local date
  // (only needed for zones more than 12 hours from UTC).
  let anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localDateKeyInTimeZone(anchor, timeZone);
    if (local === dateKey) break;
    anchor = new Date(anchor.getTime() + (local < dateKey ? DAY_MS : -DAY_MS));
  }
  return dayStartInTimeZone(anchor, 0, timeZone);
}

/** `06 Oct 2026`. */
export function formatDateKey(key: string): string {
  const parts = parseDateKey(key);
  return parts ? `${pad(parts.day)} ${MONTHS[parts.month - 1]} ${parts.year}` : key;
}

/** `Tue 06 Oct 2026`. */
export function formatDateKeyWithWeekday(key: string): string {
  return parseDateKey(key) ? `${WEEKDAYS[weekdayOf(key)]} ${formatDateKey(key)}` : key;
}
