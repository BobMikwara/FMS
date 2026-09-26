"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

export interface Point {
  x: number;
  y: number;
  label: string;
  value: number;
  series?: string;
}

function useResponsiveWidth(fallback = 640) {
  const [width, setWidth] = useState(fallback);
  if (typeof window !== "undefined") {
    // measured by the caller via ResizeObserver below
  }
  return [width, setWidth] as const;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * step);
  const chosen = candidates.find((c) => span / c <= count) ?? candidates[candidates.length - 1];
  const start = Math.floor(min / chosen) * chosen;
  const ticks: number[] = [];
  for (let v = start; v <= max + chosen * 0.5; v += chosen) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(abs < 1 ? 2 : 1);
}

interface ChartTooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

function ChartTooltip({ state }: { state: ChartTooltipState }) {
  if (!state.visible) return null;
  return (
    <div
      className="pointer-events-none absolute z-30 min-w-[8rem] -translate-x-1/2 -translate-y-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 shadow-[var(--shadow-pop)]"
      style={{ left: state.x, top: state.y - 10 }}
      role="tooltip"
    >
      <p className="mb-1 text-[0.6875rem] font-semibold text-[var(--ink)]">{state.title}</p>
      {state.rows.map((row, index) => (
        <div key={index} className="flex items-center justify-between gap-3 text-[0.6875rem]">
          <span className="flex items-center gap-1.5 text-[var(--ink-2)]">
            {row.color ? <span className="dot" style={{ background: row.color }} /> : null}
            {row.label}
          </span>
          <span className="font-semibold text-num text-[var(--ink)]">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function ChartFrame({
  height = 200,
  children,
  tooltip,
  ariaLabel,
  className,
}: {
  height?: number;
  children: React.ReactNode;
  tooltip?: ChartTooltipState;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={ariaLabel}
      >
        {children}
      </svg>
      {tooltip ? <ChartTooltip state={tooltip} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Area / line chart                                                          */
/* -------------------------------------------------------------------------- */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface AreaChartProps {
  labels: string[];
  series: Series[];
  height?: number;
  yUnit?: string;
  yFormatter?: (value: number) => string;
  showLegend?: boolean;
  ariaLabel: string;
  className?: string;
  /** Draw as a smooth line instead of stepped area. */
  smooth?: boolean;
}

export function AreaChart({
  labels,
  series,
  height = 200,
  yUnit = "",
  yFormatter = formatCompact,
  showLegend = true,
  ariaLabel,
  className,
  smooth = true,
}: AreaChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const [tooltip, setTooltip] = useState<ChartTooltipState>({ visible: false, x: 0, y: 0, title: "", rows: [] });
  const containerRef = useState<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { allMax, allMin, paths, areas } = useMemo(() => {
    const flat = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    const max = flat.length ? Math.max(...flat) : 1;
    const min = flat.length ? Math.min(...flat, 0) : 0;
    const pad = (max - min) * 0.12 || max * 0.1 || 1;
    const hi = max + pad;
    const lo = Math.max(0, min - pad * 0.4);
    const count = Math.max(1, labels.length - 1);

    const computedPaths = series.map((s) => {
      const points = s.values.map((value, index) => {
        const x = labels.length === 1 ? 50 : (index / count) * 100;
        const y = hi === lo ? 50 : 100 - ((value - lo) / (hi - lo)) * 100;
        return { x, y };
      });
      const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(" ");
      const area = `${line} L${points[points.length - 1]?.x ?? 0},100 L${points[0]?.x ?? 0},100 Z`;
      return { ...s, line, area, points };
    });

    return { allMax: hi, allMin: lo, paths: computedPaths, areas: computedPaths };
  }, [labels, series]);

  const ticks = niceTicks(allMin, allMax, 4);
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * Math.max(1, labels.length - 1));
    const clamped = Math.max(0, Math.min(labels.length - 1, index));
    setHoverIndex(clamped);
    setTooltip({
      visible: true,
      x: (labels.length === 1 ? 0.5 : clamped / Math.max(1, labels.length - 1)) * rect.width,
      y: rect.height * 0.35,
      title: labels[clamped] ?? "",
      rows: series.map((s) => ({
        label: s.label,
        value: `${yFormatter(s.values[clamped] ?? 0)}${yUnit}`,
        color: s.color,
      })),
    });
  };

  return (
    <div className={className}>
      {showLegend ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--ink-2)]">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <div
        ref={(node) => {
          containerRef[1](node);
        }}
        className="relative w-full"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => {
          setTooltip((t) => ({ ...t, visible: false }));
          setHoverIndex(null);
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((tick) => {
            const y = allMax === allMin ? 50 : 100 - ((tick - allMin) / (allMax - allMin)) * 100;
            if (y < -2 || y > 102) return null;
            return (
              <g key={tick}>
                <line x1="0" x2="100" y1={y} y2={y} stroke="var(--line)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {areas.map((s) => (
            <path key={`area-${s.key}`} d={s.area} fill={`url(#${gradientId}-${s.key})`} />
          ))}
          {paths.map((s) => (
            <path
              key={`line-${s.key}`}
              d={s.line}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hoverIndex != null && labels.length > 1 ? (
            <line
              x1={(hoverIndex / Math.max(1, labels.length - 1)) * 100}
              x2={(hoverIndex / Math.max(1, labels.length - 1)) * 100}
              y1="0"
              y2="100"
              stroke="var(--ink-3)"
              strokeWidth="0.6"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {hoverIndex != null
            ? series.map((s) => {
                const point = paths.find((p) => p.key === s.key)?.points[hoverIndex];
                if (!point) return null;
                return (
                  <circle
                    key={`dot-${s.key}`}
                    cx={point.x}
                    cy={point.y}
                    r="3"
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[...ticks].reverse().map((tick) => (
            <span key={tick} className="origin-left scale-[0.82] text-[0.625rem] text-[var(--ink-3)] text-num">
              {yFormatter(tick)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between overflow-hidden">
        {labels.map((label, index) =>
          index % labelStep === 0 || index === labels.length - 1 ? (
            <span key={`${label}-${index}`} className="text-[0.625rem] text-[var(--ink-3)]">
              {label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bar chart (grouped)                                                        */
/* -------------------------------------------------------------------------- */

export interface BarSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function BarChart({
  labels,
  series,
  height = 200,
  yUnit = "",
  yFormatter = formatCompact,
  ariaLabel,
  className,
  stacked = false,
  showLegend = true,
}: {
  labels: string[];
  series: BarSeries[];
  height?: number;
  yUnit?: string;
  yFormatter?: (value: number) => string;
  ariaLabel: string;
  className?: string;
  stacked?: boolean;
  showLegend?: boolean;
}) {
  const [tooltip, setTooltip] = useState<ChartTooltipState>({ visible: false, x: 0, y: 0, title: "", rows: [] });
  const [hover, setHover] = useState<number | null>(null);

  const { max, totals } = useMemo(() => {
    const perGroup = labels.map((_, index) =>
      stacked ? series.reduce((sum, s) => sum + (s.values[index] ?? 0), 0) : Math.max(...series.map((s) => s.values[index] ?? 0)),
    );
    return { max: Math.max(...perGroup, 1), totals: perGroup };
  }, [labels, series, stacked]);

  const ticks = niceTicks(0, max, 4);
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className={className}>
      {showLegend ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--ink-2)]">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <div
        className="relative w-full"
        style={{ height }}
        onMouseLeave={() => {
          setTooltip((t) => ({ ...t, visible: false }));
          setHover(null);
        }}
      >
        <div className="flex h-full items-end gap-[2px]" role="img" aria-label={ariaLabel}>
          {labels.map((label, index) => (
            <div
              key={`${label}-${index}`}
              className="group relative flex h-full flex-1 cursor-default items-end justify-center gap-[2px]"
              onMouseEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setHover(index);
                setTooltip({
                  visible: true,
                  x: rect.left + rect.width / 2 - (event.currentTarget.closest(".relative")?.getBoundingClientRect().left ?? 0),
                  y: 20,
                  title: label,
                  rows: series.map((s) => ({
                    label: s.label,
                    value: `${yFormatter(s.values[index] ?? 0)}${yUnit}`,
                    color: s.color,
                  })),
                });
              }}
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="pointer-events-none absolute inset-x-0 border-t border-[var(--line)]"
                  style={{ bottom: `${(tick / max) * 100}%` }}
                />
              ))}
              {series.map((s) => {
                const value = s.values[index] ?? 0;
                const heightPct = stacked ? (value / max) * 100 : (value / max) * 100;
                return (
                  <div
                    key={s.key}
                    className={cn(
                      "w-full max-w-[18px] rounded-t-[3px] transition-all duration-500",
                      hover === index ? "opacity-100" : "opacity-90",
                    )}
                    style={{
                      height: `${Math.max(value > 0 ? 1.5 : 0, heightPct)}%`,
                      background: s.color,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute left-0 top-0 flex h-full flex-col justify-between">
          {[...ticks].reverse().map((tick) => (
            <span key={tick} className="origin-left scale-[0.82] text-[0.625rem] text-[var(--ink-3)] text-num">
              {yFormatter(tick)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between overflow-hidden">
        {labels.map((label, index) =>
          index % labelStep === 0 || index === labels.length - 1 ? (
            <span key={`${label}-${index}`} className="text-[0.625rem] text-[var(--ink-3)]">
              {label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Horizontal comparison bars                                                 */
/* -------------------------------------------------------------------------- */

export function ComparisonBars({
  items,
  ariaLabel,
  className,
  valueFormatter = (v: number) => v.toLocaleString(),
}: {
  items: { label: string; value: number; max: number; color?: string; meta?: string }[];
  ariaLabel: string;
  className?: string;
  valueFormatter?: (value: number) => string;
}) {
  return (
    <div className={cn("space-y-2.5", className)} role="img" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = item.max > 0 ? (item.value / item.max) * 100 : 0;
        return (
          <div key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate text-[0.75rem] font-medium text-[var(--ink)]">{item.label}</span>
              <span className="flex-none text-[0.75rem] font-semibold text-num text-[var(--ink)]">
                {valueFormatter(item.value)}
                {item.meta ? <span className="ml-1.5 font-normal text-[var(--ink-3)]">{item.meta}</span> : null}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(1, pct)}%`, background: item.color ?? "var(--brand)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                  */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  color = "var(--brand)",
  width = 80,
  height = 24,
  className,
  ariaLabel,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 3) - 1.5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} className={className} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel}>
      <polygon points={areaPoints} fill={color} opacity="0.12" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Radial gauge                                                               */
/* -------------------------------------------------------------------------- */

export function RadialGauge({
  value,
  max = 100,
  size = 120,
  thickness = 10,
  color = "var(--brand)",
  label,
  sublabel,
  ariaLabel,
  className,
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
  sublabel?: string;
  ariaLabel: string;
  className?: string;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={ariaLabel}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-num text-lg font-semibold leading-none text-[var(--ink)]">{label}</span>
        {sublabel ? <span className="mt-0.5 text-[0.625rem] text-[var(--ink-3)]">{sublabel}</span> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut breakdown                                                            */
/* -------------------------------------------------------------------------- */

export function DonutChart({
  segments,
  size = 132,
  thickness = 14,
  centerLabel,
  centerValue,
  ariaLabel,
  className,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  ariaLabel: string;
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="relative inline-flex flex-none items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" role="img" aria-label={ariaLabel}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {segments.map((segment) => {
            const length = (segment.value / total) * circumference;
            const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`;
            const element = (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                style={{ transition: "stroke-dasharray 700ms var(--ease-out-quint)" }}
              />
            );
            offset += length;
            return element;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-num text-base font-semibold leading-none text-[var(--ink)]">{centerValue}</span>
          {centerLabel ? <span className="mt-1 text-[0.625rem] text-[var(--ink-3)]">{centerLabel}</span> : null}
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center justify-between gap-3 text-[0.75rem]">
            <span className="flex min-w-0 items-center gap-2 text-[var(--ink-2)]">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: segment.color }} />
              <span className="truncate">{segment.label}</span>
            </span>
            <span className="flex-none font-semibold text-num text-[var(--ink)]">
              {((segment.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Heatmap (alert frequency)                                                  */
/* -------------------------------------------------------------------------- */

export function Heatmap({
  rows,
  columns,
  values,
  ariaLabel,
  className,
}: {
  rows: string[];
  columns: string[];
  values: number[][];
  ariaLabel: string;
  className?: string;
}) {
  const max = Math.max(1, ...values.flat());
  return (
    <div className={cn("overflow-x-auto", className)} role="img" aria-label={ariaLabel}>
      <div className="min-w-[420px]">
        <div className="mb-1 flex gap-1 pl-12">
          {columns.map((column) => (
            <span key={column} className="flex-1 text-center text-[0.5625rem] text-[var(--ink-3)]">
              {column}
            </span>
          ))}
        </div>
        {rows.map((row, rowIndex) => (
          <div key={row} className="mb-1 flex items-center gap-1">
            <span className="w-11 flex-none text-[0.625rem] text-[var(--ink-3)]">{row}</span>
            {columns.map((column, columnIndex) => {
              const value = values[rowIndex]?.[columnIndex] ?? 0;
              const intensity = value / max;
              return (
                <span
                  key={column}
                  className="h-4 flex-1 rounded-[3px]"
                  title={`${row} ${column}: ${value}`}
                  style={{
                    background: value === 0 ? "var(--surface-3)" : `color-mix(in srgb, var(--crit) ${Math.round(12 + intensity * 88)}%, transparent)`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export { ChartFrame, useResponsiveWidth, formatCompact, niceTicks };
