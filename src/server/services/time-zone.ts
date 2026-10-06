const DEFAULT_TIME_ZONE = "Africa/Dar_es_Salaam";

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

export function normalizeTimeZone(timeZone: string | null | undefined, fallback = DEFAULT_TIME_ZONE): string {
  const candidate = timeZone?.trim();
  if (candidate) {
    try {
      formatter(candidate).format(new Date(0));
      return candidate;
    } catch {
      // Legacy or invalid time zone values safely fall back to the organization default.
    }
  }
  try {
    formatter(fallback).format(new Date(0));
    return fallback;
  } catch {
    return "UTC";
  }
}

export function datePartsInTimeZone(date: Date, timeZone: string): ZonedDateParts {
  if (!Number.isFinite(date.getTime())) throw new RangeError("Cannot convert an invalid date to local time.");
  const parts = formatter(normalizeTimeZone(timeZone)).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function localPartsAsUtcMilliseconds(parts: ZonedDateParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function zonedWallTimeToUtc(parts: ZonedDateParts, timeZone: string): Date {
  const zone = normalizeTimeZone(timeZone);
  const targetAsUtc = localPartsAsUtcMilliseconds(parts);
  let guess = targetAsUtc;

  // Reconcile the requested wall-clock time with the zone's actual offset. The
  // short iteration handles both standard offsets and daylight-saving changes.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const observed = datePartsInTimeZone(new Date(guess), zone);
    const correction = targetAsUtc - localPartsAsUtcMilliseconds(observed);
    if (correction === 0) break;
    guess += correction;
  }

  return new Date(guess);
}

export function dayStartInTimeZone(
  at: Date = new Date(),
  offsetDays = 0,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  const local = datePartsInTimeZone(at, normalizeTimeZone(timeZone));
  const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + offsetDays));
  return zonedWallTimeToUtc(
    {
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

export function minuteOfDayInTimeZone(at: Date, timeZone: string): number {
  const local = datePartsInTimeZone(at, timeZone);
  return local.hour * 60 + local.minute;
}

export function formatDateTimeInTimeZone(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function dateTimeInputValueInTimeZone(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = datePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function dateFromDateTimeInputInTimeZone(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const parts: ZonedDateParts = { year, month, day, hour, minute, second: 0 };
  const candidate = zonedWallTimeToUtc(parts, timeZone);
  const observed = datePartsInTimeZone(candidate, timeZone);
  if (
    observed.year !== year || observed.month !== month || observed.day !== day ||
    observed.hour !== hour || observed.minute !== minute
  ) return null;
  return candidate;
}

export function localBucketKeyInTimeZone(
  value: string | Date,
  granularity: "hour" | "day",
  timeZone: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = datePartsInTimeZone(date, timeZone);
  const day = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  return granularity === "hour" ? `${day}T${String(parts.hour).padStart(2, "0")}:00` : day;
}

export function localDateKeyInTimeZone(value: string | Date, timeZone: string): string {
  return localBucketKeyInTimeZone(value, "day", timeZone);
}
