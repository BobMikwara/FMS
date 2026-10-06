"use client";

import { useEffect, useState } from "react";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { tankStateForPercent, type DataState } from "@/lib/status";
import { LiveIndicator, StatusBadge } from "@/components/ui/feedback";

/**
 * The signature underground-tank visualization (PRD §13, §50, §89).
 *
 * Shows the tank as a physical vessel with a smoothly animating liquid level,
 * capacity markings, fuel-type colour and the current volume. Never relies on
 * colour alone - the status is always written out.
 */

export interface TankVisualProps {
  name: string;
  fuelType: string;
  fuelLabel?: string;
  color: string;
  volume: number;
  capacity: number;
  animate?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  showMarkings?: boolean;
  showHeader?: boolean;
  status?: "full" | "normal" | "low" | "critical" | "offline";
  lowThresholdPct?: number;
  criticalThresholdPct?: number;
  overfillThresholdPct?: number;
  temperatureC?: number | null;
  waterLevelMm?: number | null;
  dataState?: DataState;
  className?: string;
  ariaLabel?: string;
}

const sizes = {
  sm: { width: 76, height: 96, radius: 8, value: "text-sm" },
  md: { width: 108, height: 132, radius: 10, value: "text-base" },
  lg: { width: 148, height: 184, radius: 12, value: "text-lg" },
  xl: { width: 196, height: 244, radius: 14, value: "text-2xl" },
};

export function TankVisual({
  name,
  fuelType,
  fuelLabel,
  color,
  volume,
  capacity,
  animate = true,
  size = "md",
  showMarkings = true,
  showHeader = true,
  status,
  lowThresholdPct = 20,
  criticalThresholdPct = 10,
  overfillThresholdPct = 95,
  temperatureC,
  waterLevelMm,
  dataState,
  className,
  ariaLabel,
}: TankVisualProps) {
  const [displayPercent, setDisplayPercent] = useState(0);
  const percent = capacity > 0 ? Math.max(0, Math.min(100, (volume / capacity) * 100)) : 0;
  const dimension = sizes[size];

  useEffect(() => {
    if (!animate) {
      setDisplayPercent(percent);
      return;
    }
    const timer = window.setTimeout(() => setDisplayPercent(percent), 140);
    return () => window.clearTimeout(timer);
  }, [percent, animate]);

  const derivedStatus: NonNullable<TankVisualProps["status"]> =
    status ?? tankStateForPercent(percent, criticalThresholdPct, lowThresholdPct, overfillThresholdPct);

  const stateColors = {
    full: "#16a34a",
    normal: "#2563eb",
    low: "#a16207",
    critical: "#dc2626",
    offline: "#64748b",
  } as const;
  const fillColor = stateColors[derivedStatus] ?? color;
  const statusTone = { full: "ok", normal: "info", low: "brown", critical: "crit", offline: "idle" } as const;
  const statusLabel = {
    full: "Full",
    normal: "Normal",
    low: "Low",
    critical: "Critical",
    offline: "Offline",
  } as const;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      {showHeader ? (
        <div className="mb-2 w-full text-center">
          <p className="truncate text-[0.8125rem] font-semibold text-[var(--ink)]">{name}</p>
          <p className="text-[0.6875rem] text-[var(--ink-3)]">{fuelLabel ?? fuelType}</p>
        </div>
      ) : null}

      <div className="flex items-stretch gap-2">
        {showMarkings ? (
          <div className="flex flex-col justify-between py-0.5 text-[0.5625rem] text-[var(--ink-3)] text-num">
            <span>100</span>
            <span>75</span>
            <span>50</span>
            <span>25</span>
            <span>0</span>
          </div>
        ) : null}

        <div
          className="tank-shell"
          style={{ width: dimension.width, height: dimension.height, borderRadius: dimension.radius }}
          role="img"
          aria-label={
            ariaLabel ?? `${name}: ${formatNumber(volume)} of ${formatNumber(capacity)} liters, ${formatPercent(percent)} full`
          }
        >
          <div
            className="tank-liquid"
            style={{
              height: `${displayPercent}%`,
              background: `linear-gradient(180deg, ${fillColor}, color-mix(in srgb, ${fillColor} 70%, #000))`,
              boxShadow: "inset 0 6px 12px -6px rgb(255 255 255 / 0.45)",
            }}
          />
          <span className="tank-grid-line" style={{ bottom: "20%" }} title="Low threshold 20%" />
          <span className="tank-grid-line" style={{ bottom: "10%" }} title="Critical threshold 10%" />
          <span
            className="absolute left-1/2 top-0 h-1.5 w-6 -translate-x-1/2 -translate-y-full rounded-t-sm bg-[var(--line-strong)]"
            aria-hidden="true"
          />
          <span
            className={cn(
              "absolute inset-x-0 bottom-2 text-center font-semibold text-num",
              dimension.value,
              displayPercent > 55 ? "text-white" : "text-[var(--ink)]",
            )}
          >
            {percent.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="mt-2.5 w-full text-center">
        <p className={cn("font-semibold text-num text-[var(--ink)]", dimension.value)}>
          {formatNumber(Math.round(volume))} <span className="text-[0.6875rem] font-normal text-[var(--ink-3)]">L</span>
        </p>
        <p className="text-[0.6875rem] text-[var(--ink-3)] text-num">of {formatNumber(Math.round(capacity))} L</p>
      </div>

      {status || dataState || temperatureC != null || waterLevelMm != null ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          {status ? (
            <StatusBadge tone={statusTone[derivedStatus]} pulse={derivedStatus === "critical"}>
              {statusLabel[derivedStatus]}
            </StatusBadge>
          ) : null}
          {dataState ? <LiveIndicator state={dataState} /> : null}
          {temperatureC != null ? (
            <span className="badge badge-neutral" title="Product temperature">
              {temperatureC.toFixed(1)} °C
            </span>
          ) : null}
          {waterLevelMm != null && waterLevelMm > 0 ? (
            <span className="badge badge-info" title="Water level reported by probe">
              Water {waterLevelMm.toFixed(0)} mm
            </span>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compact tank row (used in grids and tables)                                */
/* -------------------------------------------------------------------------- */

export function TankBar({
  name,
  color,
  volume,
  capacity,
  href,
  className,
}: {
  name: string;
  color: string;
  volume: number;
  capacity: number;
  href?: string;
  className?: string;
}) {
  const percent = capacity > 0 ? Math.max(0, Math.min(100, (volume / capacity) * 100)) : 0;
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper href={href} className={cn("block rounded-lg p-2 transition-colors hover:bg-[var(--surface-3)]", className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[0.75rem] font-medium text-[var(--ink)]">
          <span className="h-2 w-2 flex-none rounded-full" style={{ background: color }} />
          <span className="truncate">{name}</span>
        </span>
        <span className="flex-none text-[0.75rem] font-semibold text-num text-[var(--ink)]">{percent.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
      <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)] text-num">
        {formatNumber(Math.round(volume))} / {formatNumber(Math.round(capacity))} L
      </p>
    </Wrapper>
  );
}
