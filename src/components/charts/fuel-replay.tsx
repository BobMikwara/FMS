"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { formatDateTimeInTimeZone } from "@/server/services/time-zone";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { tankStateForPercent } from "@/lib/status";
import { TankVisual } from "./tank-visual";

/**
 * Fuel Usage Replay (PRD §47).
 *
 * Replays the measured level history for a tank with play/pause, speed control
 * and a scrubbable timeline, so an operator can watch a refill or a period of
 * consumption happen and understand exactly when the change started.
 */

const SPEEDS = [1, 2, 4, 8] as const;

interface ReplayPoint {
  ts: string;
  volumeLiters: number;
  levelPercent: number;
  temperatureC: number | null;
}

interface ReplayMovement {
  id: string;
  ts: string;
  type: string;
  volume: number;
  label: string;
}

interface ReplayPayload {
  tankId: string;
  from: string;
  to: string;
  points: ReplayPoint[];
  movements: ReplayMovement[];
  refills: { volume: number; count: number };
  consumption: { volume: number; count: number };
}

export function FuelReplay({
  tankId,
  tankName,
  capacity,
  timeZone,
  criticalThresholdPct,
  lowThresholdPct,
  overfillThresholdPct,
}: {
  tankId: string;
  tankName: string;
  capacity: number;
  timeZone: string;
  criticalThresholdPct: number;
  lowThresholdPct: number;
  overfillThresholdPct: number;
}) {
  const [data, setData] = useState<ReplayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tanks/${tankId}/replay?buckets=96`)
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        if (!payload.ok) {
          setError(payload.error?.message ?? "Could not load the replay data.");
          setData(null);
          return;
        }
        setData(payload.data);
        setIndex((payload.data?.points?.length ?? 1) - 1);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tankId]);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!playing || !data || data.points.length < 2) return;
    const interval = Math.max(40, 600 / speed);
    timer.current = setInterval(() => {
      setIndex((current) => {
        if (current >= data.points.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, interval);
    return stop;
  }, [playing, speed, data, stop]);

  const point = data?.points?.[index] ?? null;
  const progress = data && data.points.length > 1 ? index / (data.points.length - 1) : 0;

  const activeMovements = useMemo(() => {
    if (!data || !point) return [];
    // Movements that fall in the bucket ending at the playhead.
    const playhead = new Date(point.ts).getTime();
    return data.movements.filter((movement) => new Date(movement.ts).getTime() <= playhead).slice(-4).reverse();
  }, [data, point]);

  if (loading) {
    return (
      <div className="card p-5">
        <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel usage replay</h3>
        <div className="mt-4 space-y-3">
          <div className="skeleton h-48 w-full rounded-xl" />
          <div className="skeleton h-10 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-5">
        <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel usage replay</h3>
        <div className="mt-4">
          <EmptyState
            icon="alert"
            title="Replay unavailable"
            description={error}
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!data || data.points.length < 2) {
    return (
      <div className="card p-5">
        <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel usage replay</h3>
        <div className="mt-4">
          <EmptyState
            icon="history"
            title="Not enough data to replay"
            description="Once this tank has a day of readings, you can replay the fuel level over time and inspect refills and consumption periods."
          />
        </div>
      </div>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel usage replay</h3>
          <p className="mt-0.5 max-w-2xl text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
            Scrubbable replay of measured level for {tankName}. Use the timeline to jump to any moment and see what the
            probe was reporting at that time. Times are shown in {timeZone}.
          </p>
        </div>
        <Badge tone="neutral">
          {data.points.length} points · {data.refills.count} refills · {data.consumption.count} outflow periods
        </Badge>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,14rem)_1fr]">
        <div className="flex justify-center">
          <TankVisual
            name={tankName}
            fuelType="fuel"
            color="#0f766e"
            volume={point?.volumeLiters ?? 0}
            capacity={capacity}
            size="lg"
            status={point
              ? tankStateForPercent(point.levelPercent, criticalThresholdPct, lowThresholdPct, overfillThresholdPct)
              : "offline"}
            lowThresholdPct={lowThresholdPct}
            criticalThresholdPct={criticalThresholdPct}
            overfillThresholdPct={overfillThresholdPct}
            showHeader={false}
          />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Readout label="Playhead" value={point ? formatDateTimeInTimeZone(point.ts, timeZone) : "-"} />
            <Readout label="Volume" value={point ? `${formatNumber(Math.round(point.volumeLiters))} L` : "-"} />
            <Readout label="Level" value={point ? `${point.levelPercent.toFixed(1)}%` : "-"} />
            <Readout label="Temperature" value={point?.temperatureC == null ? "-" : `${point.temperatureC.toFixed(1)} °C`} />
          </div>

          <div>
            <label htmlFor="replay-timeline" className="mb-2 block text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">
              Timeline
            </label>
            <div className="relative">
              <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--surface-3)]" />
              <div
                className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--brand)]"
                style={{ width: `${progress * 100}%` }}
              />
              <input
                id="replay-timeline"
                type="range"
                min={0}
                max={data.points.length - 1}
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
                className="relative z-10 h-6 w-full cursor-pointer appearance-none bg-transparent
                  [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2
                  [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--brand)]
                  [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
                  [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--brand)]"
                aria-label="Replay timeline position"
              />
            </div>
            <div className="mt-2 flex justify-between text-[0.6875rem] text-[var(--ink-3)]">
              <span className="text-num">{formatDateTimeInTimeZone(data.points[0].ts, timeZone)}</span>
              <span className="text-num">{formatDateTimeInTimeZone(data.points[data.points.length - 1].ts, timeZone)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={playing ? "secondary" : "primary"}
              onClick={() => {
                if (index >= data.points.length - 1) setIndex(0);
                setPlaying((value) => !value);
              }}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <Button variant="ghost" onClick={() => setIndex(0)} disabled={index === 0}>
              Restart
            </Button>
            <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-0.5">
              <span className="px-2 text-[0.6875rem] font-medium text-[var(--ink-3)]">Speed</span>
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSpeed(option)}
                  aria-pressed={speed === option}
                  className={cn(
                    "rounded-md px-2 py-1 text-[0.75rem] font-medium transition-colors",
                    speed === option ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-2)] hover:text-[var(--ink)]",
                  )}
                >
                  {option}×
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
            <h4 className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">
              Movements up to the playhead
            </h4>
            {activeMovements.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-[var(--ink-2)]">No movements detected before this point.</p>
            ) : (
              <ul className="mt-2.5 space-y-2">
                {activeMovements.map((movement) => (
                  <li key={movement.id} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 flex-none rounded-full",
                          movement.type === "refill" ? "bg-[var(--ok)]" : movement.type === "anomaly" ? "bg-[var(--warn)]" : "bg-[var(--info)]",
                        )}
                      />
                      <span className="truncate text-[0.8125rem] text-[var(--ink)]">{movement.label}</span>
                    </div>
                    <span className="flex-none text-[0.75rem] text-[var(--ink-3)] text-num">
                      {movement.type === "refill" ? "+" : "−"}
                      {formatNumber(Math.round(movement.volume))} L
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2.5">
      <p className="text-[0.625rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{label}</p>
      <p className="text-num mt-1 text-[0.875rem] font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}
