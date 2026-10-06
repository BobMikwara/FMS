import { useId } from "react";
import { TankVisual } from "@/components/charts/tank-visual";
import { TankStatusBadge } from "@/components/domain/badges";
import { LiveIndicator } from "@/components/ui/feedback";
import { describeFillLevel, type FillLevelInput } from "@/lib/tank-fill-level";
import type { DataState } from "@/lib/status";
import type { FuelType, Tank } from "@/server/domain/types";

export interface TankFillLevelProps {
  tank: Pick<Tank, "name" | "code" | "capacity" | "lowThresholdPct" | "criticalThresholdPct" | "overfillThresholdPct">;
  fuelType: Pick<FuelType, "systemName" | "displayName" | "color"> | null;
  /** Serial of the probe on this tank. Left out of the card when it matches the tank name. */
  deviceSerial: string | null;
  status: Tank["status"];
  dataState: DataState;
  volumeLiters: FillLevelInput["volumeLiters"];
  fillPercent: number;
  remainingCapacityLiters: number;
  coverage: FillLevelInput["coverage"];
}

const LABEL = "text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]";

/**
 * The Fill level card on a tank page: what is stored (fuel and tank identity),
 * how full it is, and how long it will last.
 *
 * Layout notes: the identity text wraps instead of truncating, every flex/grid
 * child can shrink (`min-w-0`), and the vessel graphic and the figures sit in a
 * wrapping row, so the card reflows to whatever width it is given and never
 * spills into its neighbours. There are no fixed heights and nothing is clipped.
 */
export function TankFillLevel({
  tank,
  fuelType,
  deviceSerial,
  status,
  dataState,
  volumeLiters,
  fillPercent,
  remainingCapacityLiters,
  coverage,
}: TankFillLevelProps) {
  const headingId = useId();
  const display = describeFillLevel({
    volumeLiters,
    capacityLiters: tank.capacity,
    fillPercent,
    remainingCapacityLiters,
    coverage,
  });
  const meta = [tank.code ? `Code ${tank.code}` : null, deviceSerial && deviceSerial !== tank.name ? `Probe ${deviceSerial}` : null]
    .filter(Boolean)
    .join(" \u00b7 ");

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1 basis-44">
          <h3
            id={headingId}
            className="text-[1rem] font-semibold leading-snug tracking-[-0.01em] text-[var(--ink)] [overflow-wrap:anywhere]"
          >
            {fuelType?.displayName ?? "Fuel type not set"}
          </h3>
          <p className="mt-0.5 text-[0.8125rem] font-medium leading-snug text-[var(--ink-2)] [overflow-wrap:anywhere]">
            {tank.name}
          </p>
          {meta ? <p className="mt-0.5 text-[0.75rem] leading-snug text-[var(--ink-3)] [overflow-wrap:anywhere]">{meta}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TankStatusBadge status={status} />
          <LiveIndicator state={dataState} />
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-4">
        <TankVisual
          name={tank.name}
          fuelType={fuelType?.systemName ?? "fuel"}
          fuelLabel={fuelType?.displayName}
          color={fuelType?.color ?? "#0f766e"}
          volume={volumeLiters ?? 0}
          capacity={tank.capacity}
          status={status}
          lowThresholdPct={tank.lowThresholdPct}
          criticalThresholdPct={tank.criticalThresholdPct}
          overfillThresholdPct={tank.overfillThresholdPct}
          size="md"
          showMarkings
          graphicOnly
          className="flex-none"
        />

        <dl className="grid min-w-0 flex-1 basis-36 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-4 gap-y-3.5">
          <div className="col-span-full min-w-0">
            <dt className={LABEL}>Fill level</dt>
            <dd className="text-num mt-1 text-[1.75rem] font-semibold leading-none tracking-[-0.03em] text-[var(--ink)] [overflow-wrap:anywhere]">
              {display.percent}
            </dd>
            <dd className="text-num mt-1.5 text-[0.8125rem] leading-snug text-[var(--ink-2)] [overflow-wrap:anywhere]">
              {display.volume}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className={LABEL}>Free capacity</dt>
            <dd className="text-num mt-1 text-[0.9375rem] font-semibold text-[var(--ink)] [overflow-wrap:anywhere]">{display.free}</dd>
          </div>
          {display.coverage ? (
            <div className="min-w-0">
              <dt className={LABEL}>Stock coverage</dt>
              <dd className="text-num mt-1 text-[0.9375rem] font-semibold text-[var(--ink)] [overflow-wrap:anywhere]">
                {display.coverage.value}
              </dd>
              <dd className="mt-0.5 text-[0.6875rem] leading-snug text-[var(--ink-3)]">{display.coverage.hint}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
