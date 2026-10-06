import type { ScheduledReport } from "../domain/types";
import { dateFromDateTimeInputInTimeZone, datePartsInTimeZone, normalizeTimeZone } from "./time-zone";

function localDateAfter(value: Date, days: number, timeZone: string): { year: number; month: number; day: number } {
  const local = datePartsInTimeZone(value, timeZone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dateText(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Returns the next wall-clock schedule instant strictly after `after`. */
export function nextScheduledAt(
  schedule: Pick<ScheduledReport, "period" | "dayOfWeek" | "dayOfMonth" | "timeOfDay" | "timezone">,
  after = new Date(),
): string {
  if (!Number.isFinite(after.getTime())) throw new RangeError("Schedule reference time is invalid.");
  const timezone = normalizeTimeZone(schedule.timezone);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(schedule.timeOfDay);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
    throw new RangeError("Schedule time must use the HH:MM 24-hour format.");
  }

  for (let offset = 0; offset <= 40; offset += 1) {
    const candidateDate = localDateAfter(after, offset, timezone);
    const utcCalendarDate = new Date(Date.UTC(candidateDate.year, candidateDate.month - 1, candidateDate.day));
    const daysInMonth = new Date(Date.UTC(candidateDate.year, candidateDate.month, 0)).getUTCDate();
    let matches = false;
    if (schedule.period === "daily") {
      matches = true;
    } else if (schedule.period === "weekly") {
      const wantedDay = schedule.dayOfWeek ?? 1;
      matches = utcCalendarDate.getUTCDay() === wantedDay;
    } else {
      const wantedDay = Math.min(Math.max(1, schedule.dayOfMonth ?? 1), daysInMonth);
      matches = candidateDate.day === wantedDay;
    }
    if (!matches) continue;

    const wallTime = `${dateText(candidateDate)}T${timeMatch[1]}:${timeMatch[2]}`;
    const instant = dateFromDateTimeInputInTimeZone(wallTime, timezone);
    if (instant && instant.getTime() > after.getTime()) return instant.toISOString();
  }
  throw new RangeError("Could not find the next scheduled run in the supported calendar window.");
}
