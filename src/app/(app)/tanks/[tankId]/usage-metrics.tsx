import { formatNumber } from "@/lib/utils";
import { formatDateKey } from "@/lib/calendar-dates";
import type { UsageReport } from "@/lib/tank-usage";
import { formatPeriod } from "@/lib/tank-usage-labels";
import { StatTile } from "./stat-tile";

const INTERVAL_LABEL = { hour: "Hourly", day: "Daily", week: "Weekly" } as const;
const NOT_AVAILABLE = "Not available";

const litres = (value: number) => `${formatNumber(Math.round(value))} L`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The usage figures for the selected period. Each one is computed from the same
 * report as the chart; when a figure cannot be worked out honestly (for example
 * a highest day from a single day) it says so instead of showing a number.
 */
export function UsageMetrics({ report }: { report: UsageReport }) {
  const { metrics, totals } = report;
  const daysNote = [
    `${metrics.completeDays} complete`,
    metrics.includesToday ? "today so far" : null,
    metrics.startsPartway ? "first day partial" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">Selected period</p>
          <p className="text-num mt-1.5 text-[1.125rem] font-semibold text-[var(--ink)] [overflow-wrap:anywhere]">
            {formatPeriod(report.startDate, report.endDate)}
          </p>
        </div>
        <p className="text-[0.75rem] text-[var(--ink-3)]">
          {INTERVAL_LABEL[report.interval]} intervals in {report.timeZone}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Total consumed" value={litres(totals.volume)} hint={plural(totals.events, "outflow period")} />
        <StatTile
          label="Average per day"
          value={metrics.averagePerDay === null ? NOT_AVAILABLE : litres(metrics.averagePerDay)}
          hint={metrics.averagePerDay === null ? "Needs one complete day" : `Across ${plural(metrics.completeDays, "complete day")}`}
        />
        <StatTile
          label="Highest usage day"
          value={metrics.highest ? litres(metrics.highest.volume) : NOT_AVAILABLE}
          hint={metrics.highest ? formatDateKey(metrics.highest.date) : "Needs two complete days"}
        />
        <StatTile
          label="Lowest usage day"
          value={metrics.lowest ? litres(metrics.lowest.volume) : NOT_AVAILABLE}
          hint={metrics.lowest ? formatDateKey(metrics.lowest.date) : "Needs two complete days"}
        />
        <StatTile label="Days represented" value={String(metrics.daysRepresented)} hint={daysNote} />
      </div>
    </div>
  );
}
