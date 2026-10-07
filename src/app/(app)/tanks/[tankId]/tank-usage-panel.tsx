"use client";

import { useId, useMemo } from "react";
import { UsageChart, type UsageChartDatum } from "@/components/charts/usage-chart";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { formatDateKey } from "@/lib/calendar-dates";
import { localDateKey, type UsageInterval, type UsageReport } from "@/lib/tank-usage";
import { bucketTickLabel, bucketTitle, formatPeriod } from "@/lib/tank-usage-labels";
import { UsageRangeSelector, useUsageSelection } from "@/components/domain/usage-range-selector";
import { UsageMetrics } from "./usage-metrics";
import { useTankUsage } from "./use-tank-usage";

const INTERVAL_NOUN: Record<UsageInterval, string> = { hour: "hour", day: "day", week: "week" };

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

function chartDataFor(report: UsageReport): UsageChartDatum[] {
  const context = { count: report.buckets.length, multiDay: report.startDate !== report.endDate };
  return report.buckets.map((bucket) => ({
    key: bucket.key,
    value: bucket.volume,
    tickLabel: bucketTickLabel(bucket, report.interval, context),
    title: bucketTitle(bucket, report.interval),
    rows: [{ label: "Outflow periods", value: String(bucket.events) }],
    inProgress: bucket.inProgress,
  }));
}

function UsageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading fuel usage">
      <Skeleton className="h-[4.25rem] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[17rem] w-full rounded-xl" />
    </div>
  );
}

/**
 * The tank's Usage view: one period selector that drives both the usage figures
 * and the chart. The selection is the single source of truth; it is turned into
 * one request, and the one report that comes back feeds every part of the view.
 */
export function TankUsagePanel({ tankId, tankName, timeZone }: { tankId: string; tankName: string; timeZone: string }) {
  const headingId = useId();
  const { selection, setSelection, today, resolved } = useUsageSelection(timeZone);
  const { state, reload } = useTankUsage(
    tankId,
    resolved.ok ? { preset: selection.preset, start: selection.start, end: selection.end } : null,
  );
  const report = state.status === "ready" ? state.report : null;
  const chartData = useMemo(() => (report ? chartDataFor(report) : []), [report]);

  let body: React.ReactNode;
  if (!resolved.ok) {
    body = (
      <EmptyState
        compact
        icon={<ChartIcon />}
        title="Choose a period to see usage"
        description="Pick a start date and an end date that are not in the future."
      />
    );
  } else if (state.status === "error") {
    body = <ErrorState title="Usage could not be loaded" message={state.message} onRetry={reload} />;
  } else if (!report) {
    body = <UsageSkeleton />;
  } else if (!report.hasData) {
    body = (
      <EmptyState
        compact
        icon={<ChartIcon />}
        title="No data for this period"
        description={
          report.dataStart
            ? `This tank's data begins on ${formatDateKey(localDateKey(report.dataStart, report.timeZone))}. Choose a period on or after that date.`
            : "This tank has not reported any readings yet, so there is no usage to show."
        }
      />
    );
  } else {
    body = (
      <div className="space-y-5">
        <UsageMetrics report={report} />

        {report.requestedStartDate !== report.startDate ? (
          <p className="text-[0.75rem] text-[var(--ink-3)]">
            This tank&apos;s data begins on {formatDateKey(report.startDate)}, so earlier days are not included.
          </p>
        ) : null}

        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h4 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel usage by {INTERVAL_NOUN[report.interval]}</h4>
            <p className="text-[0.75rem] text-[var(--ink-3)]">{formatPeriod(report.startDate, report.endDate)}</p>
          </div>
          {report.totals.volume > 0 ? (
            <UsageChart
              data={chartData}
              ariaLabel={`Fuel usage by ${INTERVAL_NOUN[report.interval]} for ${tankName}, ${formatPeriod(report.startDate, report.endDate)}`}
            />
          ) : (
            <EmptyState
              compact
              icon={<ChartIcon />}
              title="No fuel usage recorded"
              description="The probe reported readings in this period, but no fuel was recorded leaving the tank."
            />
          )}
        </div>

        <p className="max-w-3xl text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
          Usage is the fuel the probe recorded leaving the tank, counted in the hour or day each outflow period ended. Refills
          are not counted, and periods with no recorded outflow count as 0 L. The average and the highest and lowest day use
          complete days only, so a day that is still in progress does not distort them.
        </p>
      </div>
    );
  }

  return (
    <section className="card p-5" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-[0.8125rem] font-semibold text-[var(--ink)]">
        Fuel usage
      </h3>
      <p className="mt-0.5 max-w-2xl text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
        How much fuel left {tankName} over the period you choose. The same period drives the figures and the chart. Days and hours
        follow {timeZone}.
      </p>

      <div className="mt-4">
        <UsageRangeSelector value={selection} onChange={setSelection} maxDate={today} error={resolved.ok ? null : resolved.error} />
      </div>

      <div className="mt-5" aria-live="polite">
        {body}
      </div>
    </section>
  );
}
