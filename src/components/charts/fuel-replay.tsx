"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { formatDateTimeInTimeZone } from "@/server/services/time-zone";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { UsageRangeSelector, useUsageSelection } from "@/components/domain/usage-range-selector";
import { fetchApiData, isAbortError } from "@/lib/api-fetch";
import { formatPeriod } from "@/lib/tank-usage-labels";
import { tankStateForPercent } from "@/lib/status";
import { TankVisual } from "./tank-visual";

/**
 * Fuel Usage Replay (PRD §47).
 *
 * Replays the measured level history for a tank with play/pause, speed control
 * and a scrubbable timeline, so an operator can watch a refill or a period of
 * consumption happen and understand exactly when the change started.
 *
 * The period is chosen with the same control as the Usage view (Today, This
 * Week, This Month, Custom Date) and resolved in the tank's own time zone, so
 * the replay window and the usage figures describe the same days. Loading ends
 * in one of three states — the replay, an empty state when the period holds too
 * few readings to replay, or an error with a Retry action.
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

type ReplayState =
  | { status: "loading" }
  | { status: "ready"; data: ReplayPayload }
  | { status: "error"; message: string };

/**
 * Loads the replay series for one tank and one period. A period change cancels
 * the request in flight, and every outcome settles the state, so the panel can
 * never be left showing a skeleton.
 */
function useReplayData(tankId: string, replayWindow: { from: string; to: string } | null) {
  const [state, setState] = useState<ReplayState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const from = replayWindow?.from ?? null;
  const to = replayWindow?.to ?? null;

  useEffect(() => {
    if (!tankId || !from || !to) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    const params = new URLSearchParams({ from, to, buckets: "96" });
    fetchApiData<ReplayPayload>(`/api/tanks/${encodeURIComponent(tankId)}/replay?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Could not load the replay data.",
        });
      });
    return () => controller.abort();
  }, [tankId, from, to, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, reload };
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
  const { selection, setSelection, today, resolved } = useUsageSelection(timeZone);
  const replayWindow = resolved.ok ? { from: resolved.range.from, to: resolved.range.to } : null;
  const { state, reload } = useReplayData(tankId, replayWindow);
  const data = state.status === "ready" ? state.data : null;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // A new period means a new series: start the playhead at its latest point.
  useEffect(() => {
    setPlaying(false);
    setIndex(Math.max(0, (data?.points.length ?? 1) - 1));
  }, [data]);

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

  const period = resolved.ok ? formatPeriod(resolved.range.startDate, resolved.range.endDate) : null;

  let body: React.ReactNode;
  if (!resolved.ok) {
    body = (
      <EmptyState
        compact
        title="Choose a period to replay"
        description="Pick a start date and an end date that are not in the future."
      />
    );
  } else if (state.status === "error") {
    body = <ErrorState title="Unable to load the fuel usage replay" message={state.message} onRetry={reload} />;
  } else if (state.status === "loading") {
    body = (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the fuel usage replay">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  } else if (!data || data.points.length < 2) {
    body = (
      <EmptyState
        compact
        title="Not enough readings to replay this period"
        description={`${period} holds fewer than two readings for ${tankName}, so there is nothing to play back. Choose a longer period, such as This Week.`}
      />
    );
  } else {
    body = (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,14rem)_1fr]">
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
    );
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel usage replay</h3>
          <p className="mt-0.5 max-w-2xl text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
            Scrubbable replay of measured level for {tankName} over the period you choose. Use the timeline to jump to any
            moment and see what the probe was reporting at that time. Times are shown in {timeZone}.
          </p>
        </div>
        {data && data.points.length > 1 ? (
          <Badge tone="neutral">
            {data.points.length} points · {data.refills.count} refills · {data.consumption.count} outflow periods
          </Badge>
        ) : null}
      </div>

      <div className="mt-4">
        <UsageRangeSelector
          value={selection}
          onChange={setSelection}
          maxDate={today}
          error={resolved.ok ? null : resolved.error}
        />
      </div>
      {period ? <p className="mt-2 text-[0.75rem] text-[var(--ink-3)]">Replaying {period}</p> : null}

      <div className="mt-5" aria-live="polite">
        {body}
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
