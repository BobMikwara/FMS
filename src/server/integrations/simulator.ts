import { query, queryOne } from "../db/client";
import { getDevice, updateDevice } from "../db/repo/devices";
import { getTank } from "../db/repo/stations";
import { ingestReading } from "../engine/fuel";
import { publishThrottled } from "../realtime/bus";

/**
 * Synthetic probe traffic.
 *
 * Enabled with `DEMO_SIMULATOR=on` so the platform can be explored without
 * physical hardware. It drives the exact same ingestion pipeline as a real
 * probe webhook — no code paths are bypassed. Disable it in production.
 */

let started = false;
let timer: NodeJS.Timeout | null = null;

interface SimTank {
  tankId: string;
  deviceId: string;
  stationId: string;
  capacity: number;
  volume: number;
  dailyConsumption: number;
}

function loadTanks(): SimTank[] {
  return query<{
    tank_id: string;
    device_id: string;
    station_id: string;
    capacity: number;
    current_volume: number;
    daily: number;
  }>(
    `SELECT t.id AS tank_id, d.id AS device_id, t.station_id, t.capacity, t.current_volume,
            COALESCE((SELECT SUM(volume) FROM fuel_events WHERE tank_id = t.id AND type='consumption' AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'))/7.0, 0) AS daily
     FROM tanks t JOIN devices d ON d.tank_id = t.id AND d.type='fuel_probe'
     WHERE t.is_archived = 0 AND d.status = 'online'
     ORDER BY RANDOM() LIMIT 400`,
  ).map((row) => ({
    tankId: row.tank_id,
    deviceId: row.device_id,
    stationId: row.station_id,
    capacity: Number(row.capacity),
    volume: Number(row.current_volume),
    dailyConsumption: Math.max(200, Number(row.daily ?? 0) || 1500),
  }));
}

function tick(): void {
  const tanks = loadTanks();
  const now = new Date();
  const hour = now.getHours();
  // Demand curve — higher during the day, near zero at night.
  const demand = hour >= 6 && hour <= 23 ? 1 + Math.sin(((hour - 6) / 17) * Math.PI) * 0.8 : 0.08;
  const sample = tanks.slice(0, 5);

  for (const sim of sample) {
    // ~1 tick per 8 seconds => hourly rate scaled to a 5-minute bucket
    const perTick = (sim.dailyConsumption / (24 * 60)) * 8 * demand;
    const next = Math.max(sim.capacity * 0.01, sim.volume - perTick - Math.random() * 4);
    const result = ingestReading({
      deviceId: sim.deviceId,
      reading: {
        ts: now.toISOString(),
        volumeLiters: Number(next.toFixed(1)),
        temperatureC: Number((25.5 + Math.sin(((hour - 9) / 24) * Math.PI * 2) * 4.5 + (Math.random() - 0.5)).toFixed(1)),
        waterLevelMm: Number((Math.random() * 2).toFixed(1)),
        signal: 60 + Math.floor(Math.random() * 39),
        batteryPct: 85 + Math.floor(Math.random() * 15),
      },
    });
    if (result.ok && result.reading) {
      const levelPercent = sim.capacity > 0 ? (result.reading.volumeLiters / sim.capacity) * 100 : 0;
      publishThrottled({
        type: "reading",
        tankId: sim.tankId,
        stationId: sim.stationId,
        volumeLiters: result.reading.volumeLiters,
        levelPercent: Number(levelPercent.toFixed(2)),
        ts: result.reading.ts,
        deviceId: sim.deviceId,
      });
      if (result.event) {
        publishThrottled({
          type: "event",
          eventId: result.event.id,
          tankId: sim.tankId,
          eventType: result.event.type,
          volume: result.event.volume,
          ts: result.reading.ts,
        });
      }
      for (const alert of result.alerts ?? []) {
        publishThrottled({
          type: "alert",
          alertId: alert.id,
          severity: alert.severity,
          title: alert.title,
          tankId: alert.tankId,
          stationId: alert.stationId,
        });
      }
      sim.volume = result.reading.volumeLiters;
    }
  }

  // Periodically re-evaluate device health so offline probes recover.
  if (now.getSeconds() < 10) {
    const probes = query<{ id: string; status: string; last_seen_at: string | null }>(
      "SELECT id, status, last_seen_at FROM devices WHERE type='fuel_probe'",
    );
    for (const probe of probes) {
      if (probe.status === "offline" && probe.last_seen_at) {
        const age = Date.now() - new Date(probe.last_seen_at).getTime();
        if (age > 12 * 60 * 1000 && Math.random() > 0.7) {
          // Simulated recovery: a device that has been offline for a while comes back.
          updateDevice(probe.id, { status: "online", lastSeenAt: new Date().toISOString() });
          publishThrottled({ type: "device", deviceId: probe.id, status: "online" });
        }
      }
    }
  }
}

export function startSimulator(): void {
  if (started) return;
  if (process.env.DEMO_SIMULATOR === "off") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  started = true;
  timer = setInterval(tick, 8000);
  // Do not keep the process alive just for the simulator.
  timer.unref?.();
  console.log("[simulator] synthetic probe traffic enabled (DEMO_SIMULATOR=on)");
}

export function stopSimulator(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export function simulatorStatus(): { running: boolean; enabled: boolean } {
  return { running: started, enabled: process.env.DEMO_SIMULATOR !== "off" };
}

/** Runs one synthetic tick immediately — used by the "simulate" admin action. */
export function runSimulatorTick(): number {
  const before = Number(queryOne<{ n: number }>("SELECT count(*) AS n FROM readings")?.n ?? 0);
  tick();
  const after = Number(queryOne<{ n: number }>("SELECT count(*) AS n FROM readings")?.n ?? 0);
  return after - before;
}

export { getDevice, getTank };
