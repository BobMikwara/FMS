import { query, queryOne } from "../db/client";
import { getDevice, updateDevice } from "../db/repo/devices";
import { getTank } from "../db/repo/stations";
import { ingestReading } from "../engine/fuel";

/**
 * Synthetic probe traffic.
 *
 * It is available only as an explicitly invoked local/demo tool so it never
 * becomes a process-local background worker on Vercel. It drives the exact same
 * ingestion pipeline as a real probe webhook — no code paths are bypassed.
 */

interface SimTank {
  organizationId: string;
  tankId: string;
  deviceId: string;
  stationId: string;
  capacity: number;
  volume: number;
  dailyConsumption: number;
}

async function loadTanks(): Promise<SimTank[]> {
  return (await query<{
    tank_id: string;
    device_id: string;
    organization_id: string;
    station_id: string;
    capacity: number;
    current_volume: number;
    daily: number;
  }>(
    `SELECT t.id AS tank_id, d.id AS device_id, t.organization_id, t.station_id, t.capacity, t.current_volume,
            COALESCE((SELECT SUM(volume) FROM fuel_events WHERE tank_id = t.id AND type='consumption' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'))/7.0, 0) AS daily
     FROM tanks t JOIN devices d ON d.tank_id = t.id AND d.type='fuel_probe'
     WHERE t.is_archived = 0 AND d.status = 'online'
     ORDER BY RANDOM() LIMIT 400`,
  )).map((row) => ({
    organizationId: row.organization_id,
    tankId: row.tank_id,
    deviceId: row.device_id,
    stationId: row.station_id,
    capacity: Number(row.capacity),
    volume: Number(row.current_volume),
    dailyConsumption: Math.max(200, Number(row.daily ?? 0) || 1500),
  }));
}

async function tick(): Promise<void> {
  const tanks = (await loadTanks());
  const now = new Date();
  const hour = now.getHours();
  // Demand curve — higher during the day, near zero at night.
  const demand = hour >= 6 && hour <= 23 ? 1 + Math.sin(((hour - 6) / 17) * Math.PI) * 0.8 : 0.08;
  const sample = tanks.slice(0, 5);

  for (const sim of sample) {
    // ~1 tick per 8 seconds => hourly rate scaled to a 5-minute bucket
    const perTick = (sim.dailyConsumption / (24 * 60)) * 8 * demand;
    const next = Math.max(sim.capacity * 0.01, sim.volume - perTick - Math.random() * 4);
    const result = (await ingestReading({
      deviceId: sim.deviceId,
      reading: {
        ts: now.toISOString(),
        volumeLiters: Number(next.toFixed(1)),
        temperatureC: Number((25.5 + Math.sin(((hour - 9) / 24) * Math.PI * 2) * 4.5 + (Math.random() - 0.5)).toFixed(1)),
        waterLevelMm: Number((Math.random() * 2).toFixed(1)),
        signal: 60 + Math.floor(Math.random() * 39),
        batteryPct: 85 + Math.floor(Math.random() * 15),
      },
    }));
    if (result.ok && result.reading) {
      // The reading, derived event and alerts are already durable. The SSE
      // endpoint polls those rows, so no process-local fan-out is required.
      sim.volume = result.reading.volumeLiters;
    }
  }

  // Periodically re-evaluate device health so offline probes recover.
  if (now.getSeconds() < 10) {
    const probes = (await query<{ id: string; organization_id: string; status: string; last_seen_at: string | null }>(
      "SELECT id, organization_id, status, last_seen_at FROM devices WHERE type='fuel_probe'",
    ));
    for (const probe of probes) {
      if (probe.status === "offline" && probe.last_seen_at) {
        const age = Date.now() - new Date(probe.last_seen_at).getTime();
        if (age > 12 * 60 * 1000 && Math.random() > 0.7) {
          // Simulated recovery: a device that has been offline for a while comes back.
          (await updateDevice(probe.id, { status: "online", lastSeenAt: new Date().toISOString() }));
        }
      }
    }
  }
}

/** Runs one synthetic tick only when explicitly invoked by a local/demo tool. */
export async function runSimulatorTick(): Promise<number> {
  const before = Number((await queryOne<{ n: number }>("SELECT count(*) AS n FROM readings"))?.n ?? 0);
  (await tick());
  const after = Number((await queryOne<{ n: number }>("SELECT count(*) AS n FROM readings"))?.n ?? 0);
  return after - before;
}

export { getDevice, getTank };
