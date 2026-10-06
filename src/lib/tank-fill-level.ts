import { formatNumber, formatPercent } from "@/lib/utils";

/**
 * Display model for the tank "Fill level" card.
 *
 * Every figure comes from values the server has already computed for the tank
 * (latest reading, fill percent, remaining capacity, stock coverage). Nothing is
 * derived or estimated here - this only decides how the numbers read, including
 * what to say honestly when a tank has no reading yet.
 */

export interface FillLevelInput {
  /** Latest measured volume in litres, or null when the tank has no reading yet. */
  volumeLiters: number | null;
  capacityLiters: number;
  fillPercent: number;
  remainingCapacityLiters: number;
  /** Null when the viewer may not see consumption data. */
  coverage: { avgDailyConsumption: number; daysRemaining: number | null } | null;
}

export interface FillLevelDisplay {
  hasReading: boolean;
  /** Headline figure, e.g. `49.5%`. */
  percent: string;
  /** Measured volume against capacity, e.g. `7,424 L of 15,000 L`. */
  volume: string;
  /** Free capacity, e.g. `7,576 L`. */
  free: string;
  /** Stock coverage, or null when the viewer cannot see it. */
  coverage: { value: string; hint: string } | null;
}

const NOT_AVAILABLE = "Not available";

export function describeFillLevel(input: FillLevelInput): FillLevelDisplay {
  const hasReading = input.volumeLiters != null;
  const litres = (value: number) => `${formatNumber(Math.round(value))} L`;

  let coverage: FillLevelDisplay["coverage"] = null;
  if (input.coverage) {
    const { daysRemaining, avgDailyConsumption } = input.coverage;
    coverage = {
      value: daysRemaining == null ? NOT_AVAILABLE : `${daysRemaining.toFixed(1)} days`,
      hint: avgDailyConsumption > 0 ? `${litres(avgDailyConsumption)}/day average` : "No consumption recorded yet",
    };
  }

  return {
    hasReading,
    percent: hasReading ? formatPercent(input.fillPercent, 1) : NOT_AVAILABLE,
    volume: hasReading ? `${litres(input.volumeLiters as number)} of ${litres(input.capacityLiters)}` : "Awaiting first reading",
    free: hasReading ? litres(input.remainingCapacityLiters) : NOT_AVAILABLE,
    coverage,
  };
}
