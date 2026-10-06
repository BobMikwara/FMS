import { query, queryOne, toIso } from "../client";
import type { UsageEvent } from "@/lib/tank-usage";

/**
 * Read-only queries behind the tank Usage view.
 *
 * Usage is the sum of `consumption` movements, exactly as `movementTotals`
 * defines the "Fuel consumption / tank outflow (today)" figure, so the two never
 * disagree. Both queries run on the existing (tank_id, ts) indexes.
 */

export async function consumptionEventsForTank(tankId: string, from: string, to: string): Promise<UsageEvent[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ts, volume FROM fuel_events
     WHERE tank_id = ? AND type = 'consumption' AND ts >= ? AND ts <= ?
     ORDER BY ts ASC`,
    [tankId, from, to],
  );
  return rows.map((row) => ({ ts: String(row.ts), volume: Number(row.volume ?? 0) }));
}

/** When the tank's history begins: its earliest reading or movement, or null when it has neither. */
export async function historyStartForTank(tankId: string): Promise<string | null> {
  const [reading, movement] = await Promise.all([
    queryOne<Record<string, unknown>>("SELECT MIN(ts) AS ts FROM readings WHERE tank_id = ?", [tankId]),
    queryOne<Record<string, unknown>>("SELECT MIN(ts) AS ts FROM fuel_events WHERE tank_id = ?", [tankId]),
  ]);
  const starts = [toIso(reading?.ts), toIso(movement?.ts)].filter((value): value is string => value !== null);
  return starts.length > 0 ? starts.sort()[0] : null;
}
