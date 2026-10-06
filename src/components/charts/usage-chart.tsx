"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { formatAxisTick, niceAxis } from "@/lib/chart-axis";
import { ChartTooltip, type ChartTooltipState } from "./charts";

/**
 * Bar chart of fuel used per period (hour, day or week).
 *
 * Every bar is one real bucket of recorded consumption: nothing is smoothed or
 * interpolated, and a period with no usage is an empty slot rather than a
 * missing one. Bars are plain elements sized as a percentage of a round axis, so
 * the chart stays crisp at any width. Values are available on hover, on tap and
 * with the arrow keys, and as a table for screen readers.
 */

export interface UsageChartDatum {
  key: string;
  value: number;
  /** Short label under the bar, shown when there is room for it. */
  tickLabel: string;
  /** Tooltip heading. */
  title: string;
  /** Further tooltip rows after the value. */
  rows?: { label: string; value: string }[];
  /** Draws the bar lighter to show the period is still running. */
  inProgress?: boolean;
}

export interface UsageChartProps {
  data: readonly UsageChartDatum[];
  ariaLabel: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  /** Tooltip label for the bar value. */
  seriesLabel?: string;
  formatValue?: (value: number) => string;
  className?: string;
}

const BAR_COLOR = "var(--brand)";
const TOOLTIP_HALF_WIDTH = 124;
/** Room the tooltip needs above its anchor so it stays inside the plot. */
const TOOLTIP_CLEARANCE = 84;

const defaultFormat = (value: number) => `${formatNumber(value, Number.isInteger(value) ? 0 : 1)} L`;

function useElementWidth(ref: React.RefObject<HTMLElement | null>, fallback = 640) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function UsageChart({
  data,
  ariaLabel,
  xAxisLabel = "Date / Time",
  yAxisLabel = "Fuel (L)",
  seriesLabel = "Fuel used",
  formatValue = defaultFormat,
  className,
}: UsageChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotWidth = useElementWidth(plotRef);
  const [active, setActive] = useState<number | null>(null);
  const count = data.length;

  useEffect(() => setActive(null), [data]);

  const axis = useMemo(() => niceAxis(Math.max(0, ...data.map((datum) => datum.value))), [data]);
  if (count === 0) return null;

  const height = plotWidth < 420 ? 200 : 260;
  const gutter = Math.max(...axis.ticks.map((tick) => formatAxisTick(tick).length)) * 6.6 + 10;
  const labelWidth = Math.max(4, ...data.map((datum) => datum.tickLabel.length)) * 6.4 + 16;
  const labelStep = Math.max(1, Math.ceil((count * labelWidth) / Math.max(plotWidth, 1)));

  const shown = active === null ? null : data[active];
  const centre = active === null ? 0 : ((active + 0.5) / count) * plotWidth;
  const tooltip: ChartTooltipState | null = shown
    ? {
        visible: true,
        x: plotWidth <= TOOLTIP_HALF_WIDTH * 2 ? plotWidth / 2 : Math.min(Math.max(centre, TOOLTIP_HALF_WIDTH), plotWidth - TOOLTIP_HALF_WIDTH),
        // Sit just above the bar, but keep the tooltip in the upper half of the plot so a short
        // or empty bar does not leave it covering its neighbours.
        y: Math.min(Math.max(height * (1 - shown.value / axis.max), TOOLTIP_CLEARANCE), height * 0.5),
        title: shown.title,
        rows: [{ label: seriesLabel, value: formatValue(shown.value), color: BAR_COLOR }, ...(shown.rows ?? [])],
      }
    : null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") setActive((current) => Math.min(count - 1, (current ?? -1) + 1));
    else if (event.key === "ArrowLeft") setActive((current) => Math.max(0, (current ?? count) - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(count - 1);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };

  return (
    <figure className={cn("w-full", className)}>
      <p className="mb-2.5 text-[0.75rem] font-medium text-[var(--ink-2)]">{yAxisLabel}</p>

      <div className="flex gap-2">
        <div className="relative flex-none" style={{ width: gutter, height }} aria-hidden="true">
          {axis.ticks.map((tick) => (
            <span
              key={tick}
              className="text-num absolute right-0 translate-y-1/2 text-[0.625rem] leading-none text-[var(--ink-3)]"
              style={{ bottom: `${(tick / axis.max) * 100}%` }}
            >
              {formatAxisTick(tick)}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          role="group"
          aria-label={`${ariaLabel}. Use the left and right arrow keys to read each bar.`}
          tabIndex={0}
          className="relative min-w-0 flex-1 rounded-sm"
          style={{ height }}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
        >
          {axis.ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden="true"
              className={cn("pointer-events-none absolute inset-x-0 border-t", tick === 0 ? "border-[var(--line-strong)]" : "border-[var(--line)]")}
              style={{ bottom: `${(tick / axis.max) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex items-end gap-[2px]" aria-hidden="true">
            {data.map((datum, index) => {
              const isActive = index === active;
              return (
                <div
                  key={datum.key}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={() => setActive(index)}
                >
                  {isActive ? <span className="absolute inset-0 rounded-md bg-[var(--surface-3)]" /> : null}
                  {datum.value > 0 ? (
                    <span
                      className="relative w-full max-w-[48px] rounded-t-[4px] transition-opacity"
                      style={{
                        height: `max(2px, ${(datum.value / axis.max) * 100}%)`,
                        background: BAR_COLOR,
                        opacity: datum.inProgress ? 0.55 : isActive ? 1 : 0.88,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          {tooltip ? <ChartTooltip state={tooltip} className="w-max max-w-[16rem]" /> : null}
        </div>
      </div>

      <div className="relative mt-2 h-4" style={{ marginLeft: gutter + 8 }} aria-hidden="true">
        {data.map((datum, index) =>
          index % labelStep === 0 ? (
            <span
              key={datum.key}
              className="text-num absolute -translate-x-1/2 whitespace-nowrap text-[0.625rem] text-[var(--ink-3)]"
              style={{ left: `${((index + 0.5) / count) * 100}%` }}
            >
              {datum.tickLabel}
            </span>
          ) : null,
        )}
      </div>
      <p className="mt-2 text-center text-[0.75rem] font-medium text-[var(--ink-2)]" style={{ marginLeft: gutter + 8 }}>
        {xAxisLabel}
      </p>

      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{yAxisLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.title}</th>
              <td>{formatValue(datum.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only" aria-live="polite">
        {shown ? `${shown.title}: ${formatValue(shown.value)}` : ""}
      </p>
    </figure>
  );
}
