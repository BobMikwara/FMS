/**
 * Round axis scales for charts of non-negative values.
 *
 * The maximum is rounded up to a whole number of steps, so the tallest bar never
 * touches the top of the plot and every gridline sits on a round number.
 */

export interface AxisScale {
  /** Top of the axis; always at least the largest value. */
  max: number;
  step: number;
  /** Tick values from 0 to `max`. */
  ticks: number[];
}

const STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10] as const;

export function niceAxis(maxValue: number, targetTicks = 4): AxisScale {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { max: 1, step: 1, ticks: [0, 1] };

  const base = Math.pow(10, Math.floor(Math.log10(maxValue / targetTicks)));
  const step = STEP_MULTIPLIERS.map((multiplier) => multiplier * base).find((candidate) => maxValue / candidate <= targetTicks) ?? 10 * base;
  const max = Math.ceil(maxValue / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= max + step / 1000; tick += step) ticks.push(Number(tick.toFixed(6)));
  return { max: Number(max.toFixed(6)), step, ticks };
}

/** Axis label with thousands separators and a decimal only when the value needs one. */
export function formatAxisTick(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}
