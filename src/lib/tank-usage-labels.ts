import {
  MONTHS,
  WEEKDAYS,
  formatDateKey,
  formatDateKeyWithWeekday,
  pad,
  parseDateKey,
  weekdayOf,
} from "./calendar-dates";
import type { UsageBucket, UsageInterval } from "./tank-usage";

/** How usage periods and buckets read on screen: axis labels, tooltip headings and the period summary. */

/** `06 Oct 2026` for a single day, `01 Oct 2026 to 06 Oct 2026` otherwise. */
export function formatPeriod(startDate: string, endDate: string): string {
  return startDate === endDate ? formatDateKey(startDate) : `${formatDateKey(startDate)} to ${formatDateKey(endDate)}`;
}

/**
 * Short axis label for a bucket. `count` is how many buckets the axis has and
 * `multiDay` says whether the period spans more than one local day; both decide
 * how much detail a label needs to stay unambiguous.
 */
export function bucketTickLabel(
  bucket: UsageBucket,
  interval: UsageInterval,
  context: { count: number; multiDay: boolean },
): string {
  if (interval === "hour") {
    const hour = bucket.key.slice(11, 16);
    return context.multiDay ? `${WEEKDAYS[weekdayOf(bucket.key.slice(0, 10))]} ${hour}` : hour;
  }
  const parts = parseDateKey(bucket.key);
  if (!parts) return bucket.key;
  if (interval === "day" && context.count <= 8) return `${WEEKDAYS[weekdayOf(bucket.key)]} ${pad(parts.day)}`;
  return `${pad(parts.day)} ${MONTHS[parts.month - 1]}`;
}

/** Full description of a bucket, used as the tooltip heading. */
export function bucketTitle(bucket: UsageBucket, interval: UsageInterval): string {
  const suffix = bucket.inProgress ? " (so far)" : "";
  if (interval === "hour") {
    const date = bucket.key.slice(0, 10);
    const hour = Number(bucket.key.slice(11, 13));
    return `${formatDateKeyWithWeekday(date)}, ${pad(hour)}:00 to ${pad((hour + 1) % 24)}:00${suffix}`;
  }
  if (interval === "week" && bucket.endDate !== bucket.key) {
    return `${formatDateKeyWithWeekday(bucket.key)} to ${formatDateKeyWithWeekday(bucket.endDate)}${suffix}`;
  }
  return `${formatDateKeyWithWeekday(bucket.key)}${suffix}`;
}
