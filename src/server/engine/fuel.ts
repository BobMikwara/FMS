import { query, queryOne, execute, nowIso } from "../db/client";
import {
  acknowledgeAlert,
  activeAlertsForTank,
  createAlert,
  listEnabledRules,
} from "../db/repo/alerts";
import { createEvent } from "../db/repo/events";
import { insertReading, latestReadingForTank } from "../db/repo/readings";
import { getDevice, getDeviceBySerial, updateDevice } from "../db/repo/devices";
import { getTank, getStation, updateTank } from "../db/repo/stations";
import { getOrganization, getSetting, getSettings } from "../db/repo/core";
import { createNotification } from "../db/repo/core";
import type { Alert, Device, Reading, Tank } from "../domain/types";

/**
 * Device Integration Layer + Fuel Monitoring Engine.
 *
 *   RAW PAYLOAD ──▶ normalizeReading() ──▶ validation ──▶ Reading (immutable)
 *                                                   └──▶ compare previous
 *                                                       └──▶ classify movement
 *                                                           └──▶ FuelEvent
 *                                                               └──▶ AlertRule
 *                                                                   └──▶ Alert + Notification
 *
 * The layer is deliberately vendor-agnostic: providers only have to produce a
 * `NormalizedReading`. See `src/server/integrations/providers.ts`.
 */

export interface NormalizedReading {
  /** ISO-8601 UTC timestamp of the measurement. */
  ts: string;
  volumeLiters: number | null;
  levelMm?: number | null;
  levelPercent?: number | null;
  temperatureC?: number | null;
  waterLevelMm?: number | null;
  signal?: number | null;
  batteryPct?: number | null;
  raw?: Record<string, unknown>;
}

export interface IngestOptions {
  /** Identify the device by serial number (webhook) or by id (internal). */
  deviceSerial?: string;
  deviceId?: string;
  reading: NormalizedReading;
}

export interface IngestResult {
  ok: boolean
  rejected?: "unknown_device" | "unassigned_device" | "invalid_reading" | "duplicate";
  message?: string;
  reading?: Reading;
  event?: { id: string; type: string; volume: number } | null;
  alerts?: Alert[];
}

interface EngineConfig {
  refillThresholdLiters: number;
  consumptionMinLiters: number;
  rapidChangeLitersPerMin: number;
  deviceOfflineMinutes: number;
  deviceDelayedSeconds: number;
  temperatureMinC: number;
  temperatureMaxC: number;
  waterAlarmMm: number;
  reconciliationVariancePct: number;
}

const DEFAULT_CONFIG: EngineConfig = {
  refillThresholdLiters: 120,
  consumptionMinLiters: 5,
  rapidChangeLitersPerMin: 250,
  deviceOfflineMinutes: 10,
  deviceDelayedSeconds: 90,
  temperatureMinC: -5,
  temperatureMaxC: 45,
  waterAlarmMm: 25,
  reconciliationVariancePct: 0.5,
};

function loadConfig(orgId: string): EngineConfig {
  const settings = getSettings(orgId);
  const stored = (settings.engine ?? {}) as Partial<EngineConfig>;
  return { ...DEFAULT_CONFIG, ...stored };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Rejects impossible readings (PRD §65). Invalid readings are flagged, never
 * silently mixed into normal reporting.
 */
export function validateReading(tank: Tank, reading: NormalizedReading): ValidationResult {
  if (reading.volumeLiters == null || Number.isNaN(reading.volumeLiters)) {
    return { valid: false, reason: "Reading contains no volume measurement" };
  }
  if (reading.volumeLiters < 0) {
    return { valid: false, reason: `Negative volume reported (${reading.volumeLiters} L)` };
  }
  // Allow a small tolerance above capacity for sensor noise, but reject nonsense.
  if (reading.volumeLiters > tank.capacity * 1.05) {
    return {
      valid: false,
      reason: `Reported volume ${Math.round(reading.volumeLiters)} L exceeds tank capacity ${Math.round(tank.capacity)} L`,
    };
  }
  if (reading.temperatureC != null && (reading.temperatureC < -40 || reading.temperatureC > 90)) {
    return { valid: false, reason: `Implausible temperature (${reading.temperatureC} °C)` };
  }
  return { valid: true };
}

/* -------------------------------------------------------------------------- */
/* Operating hours                                                            */
/* -------------------------------------------------------------------------- */

export function isWithinOperatingHours(station: { openingTime: string; closingTime: string }, at: Date): boolean {
  const minutes = at.getHours() * 60 + at.getMinutes();
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map((v) => Number(v));
    return (h || 0) * 60 + (m || 0);
  };
  const open = toMinutes(station.openingTime);
  const close = toMinutes(station.closingTime);
  if (close <= open) return true; // 24h station
  return minutes >= open && minutes <= close;
}

/* -------------------------------------------------------------------------- */
/* Movement classification                                                    */
/* -------------------------------------------------------------------------- */

export type MovementKind = "refill" | "consumption" | "anomaly" | "none";

export interface MovementDecision {
  kind: MovementKind;
  delta: number;
  ratePerMinute: number;
  minutes: number;
  confidence: "high" | "medium" | "low";
  status: "confirmed" | "suspected" | "rejected";
  reason: string | null;
}

/**
 * Classifies the change between two consecutive readings. Never labels a
 * decrease as theft — unexplained decreases become `anomaly` events with a
 * supporting reason so operators can investigate (PRD §14, §40).
 */
export function classifyMovement(args: {
  previous: Reading | null;
  next: NormalizedReading & { volumeLiters: number };
  config: EngineConfig;
  withinOperatingHours: boolean;
}): MovementDecision {
  const { previous, next, config, withinOperatingHours } = args;
  if (!previous) {
    return { kind: "none", delta: 0, ratePerMinute: 0, minutes: 0, confidence: "high", status: "confirmed", reason: null };
  }
  const delta = next.volumeLiters - previous.volumeLiters;
  const minutes = Math.max(
    0.016,
    (new Date(next.ts).getTime() - new Date(previous.ts).getTime()) / 60000,
  );
  const ratePerMinute = Math.abs(delta) / minutes;

  if (Math.abs(delta) < config.consumptionMinLiters) {
    return {
      kind: "none",
      delta,
      ratePerMinute,
      minutes,
      confidence: "high",
      status: "confirmed",
      reason: null,
    };
  }

  if (delta > 0) {
    const outside = !withinOperatingHours;
    if (delta >= config.refillThresholdLiters) {
      const suspicious = outside || ratePerMinute > config.rapidChangeLitersPerMin * 4;
      return {
        kind: suspicious ? "anomaly" : "refill",
        delta,
        ratePerMinute,
        minutes,
        confidence: suspicious ? "low" : "high",
        status: suspicious ? "suspected" : "confirmed",
        reason: suspicious
          ? outside
            ? "Large volume increase detected outside configured operating hours"
            : "Volume increased faster than a physical delivery can plausibly fill the tank"
          : null,
      };
    }
    return { kind: "none", delta, ratePerMinute, minutes, confidence: "high", status: "confirmed", reason: null };
  }

  // Negative delta
  const drop = Math.abs(delta);
  const outside = !withinOperatingHours;
  const rapid = ratePerMinute > config.rapidChangeLitersPerMin;
  if (outside && (drop >= config.refillThresholdLiters || rapid)) {
    return {
      kind: "anomaly",
      delta,
      ratePerMinute,
      minutes,
      confidence: "medium",
      status: "suspected",
      reason: outside
        ? `Fuel dropped ${Math.round(drop)} L outside operating hours`
        : `Fuel dropped ${Math.round(drop)} L at ${Math.round(ratePerMinute)} L/min`,
    };
  }
  if (rapid && drop >= config.refillThresholdLiters) {
    return {
      kind: "anomaly",
      delta,
      ratePerMinute,
      minutes,
      confidence: "medium",
      status: "suspected",
      reason: `Sudden drop of ${Math.round(drop)} L in ${minutes.toFixed(1)} min`,
    };
  }
  return { kind: "consumption", delta, ratePerMinute, minutes, confidence: "high", status: "confirmed", reason: null };
}

/* -------------------------------------------------------------------------- */
/* Ingest pipeline                                                            */
/* -------------------------------------------------------------------------- */

export function ingestReading(options: IngestOptions): IngestResult {
  const device: Device | null = options.deviceId
    ? getDevice(options.deviceId)
    : options.deviceSerial
      ? getDeviceBySerial(options.deviceSerial)
      : null;

  if (!device) {
    return { ok: false, rejected: "unknown_device", message: "Unrecognised device serial number" };
  }
  if (device.type !== "fuel_probe") {
    return {
      ok: false,
      rejected: "unassigned_device",
      message:
        "This device is a GPS tracker, not a fuel probe. Trackers report position, speed and ignition through the vehicle endpoint, not tank volume.",
    };
  }
  if (!device.tankId) {
    return {
      ok: false,
      rejected: "unassigned_device",
      message:
        "This probe is not assigned to a tank yet. Assign it to a tank before it can submit readings.",
    };
  }

  const tank = getTank(device.tankId);
  if (!tank) {
    return { ok: false, rejected: "unassigned_device", message: "Assigned tank no longer exists" };
  }

  const validation = validateReading(tank, options.reading);
  if (!validation.valid) {
    flagInvalidReading(device, tank, validation.reason ?? "Invalid reading");
    return { ok: false, rejected: "invalid_reading", message: validation.reason };
  }

  const station = getStation(tank.stationId);
  if (!station) {
    return { ok: false, rejected: "unassigned_device", message: "Assigned station no longer exists" };
  }

  const config = loadConfig(tank.organizationId);
  const previous = latestReadingForTank(tank.id);
  const ts = options.reading.ts ?? nowIso();

  const volumeLiters = options.reading.volumeLiters as number;
  const capacity = tank.capacity;
  const levelPercent = options.reading.levelPercent ?? (volumeLiters / capacity) * 100;

  // Guard against duplicate/back-dated payloads flooding the series.
  if (previous && new Date(ts).getTime() < new Date(previous.ts).getTime()) {
    return { ok: false, rejected: "duplicate", message: "Reading timestamp is older than the latest stored reading" };
  }

  const reading = insertReading({
    ts,
    organizationId: tank.organizationId,
    tankId: tank.id,
    deviceId: device.id,
    volumeLiters,
    levelPercent,
    levelMm: options.reading.levelMm ?? null,
    temperatureC: options.reading.temperatureC ?? null,
    waterLevelMm: options.reading.waterLevelMm ?? null,
    signal: options.reading.signal ?? device.signalStrength ?? null,
    batteryPct: options.reading.batteryPct ?? device.batteryPct ?? null,
    raw: options.reading.raw ?? null,
  });

  const at = new Date(ts);
  const withinHours = isWithinOperatingHours(station, at);
  const decision = classifyMovement({
    previous,
    next: { ...options.reading, volumeLiters, ts },
    config,
    withinOperatingHours: withinHours,
  });

  const tankPatch: Record<string, unknown> = {
    currentVolume: volumeLiters,
    lastReadingAt: ts,
    lastValidReadingAt: ts,
    currentTempC: options.reading.temperatureC ?? tank.currentTempC,
    currentLevelMm: options.reading.levelMm ?? tank.currentLevelMm,
    waterLevelMm: options.reading.waterLevelMm ?? tank.waterLevelMm,
    status: tankStatusFromPercent(levelPercent),
  };
  updateTank(tank.id, tankPatch);

  const devicePatch: Record<string, unknown> = {
    status: "online",
    lastSeenAt: ts,
    lastReadingAt: ts,
  };
  if (options.reading.signal != null) devicePatch.signalStrength = options.reading.signal;
  if (options.reading.batteryPct != null) devicePatch.batteryPct = options.reading.batteryPct;
  updateDevice(device.id, devicePatch);

  let event: { id: string; type: string; volume: number } | null = null;
  const alerts: Alert[] = [];

  if (decision.kind !== "none") {
    const created = createEvent({
      ts,
      organizationId: tank.organizationId,
      stationId: tank.stationId,
      tankId: tank.id,
      deviceId: device.id,
      type: decision.kind,
      volume: Math.abs(decision.delta),
      levelBefore: previous ? previous.volumeLiters : volumeLiters,
      levelAfter: volumeLiters,
      durationSec: Math.round(decision.minutes * 60),
      confidence: decision.confidence,
      status: decision.status,
      reason: decision.reason,
    });
    event = { id: created.id, type: created.type, volume: created.volume };
  }

  alerts.push(
    ...evaluateTankAlerts({
      tank,
      device,
      levelPercent,
      volumeLiters,
      temperatureC: options.reading.temperatureC ?? null,
      waterLevelMm: options.reading.waterLevelMm ?? null,
      config,
      ts,
      decision,
    }),
  );

  if (event && (event.type === "anomaly" || event.type === "refill")) {
    // Refill / anomaly events may themselves warrant a notification.
    notifyEvent(device, tank, event, levelPercent);
  }

  return { ok: true, reading, event, alerts };
}

/* -------------------------------------------------------------------------- */
/* Alert evaluation                                                           */
/* -------------------------------------------------------------------------- */

function tankStatusFromPercent(percent: number): Tank["status"] {
  if (percent >= 95) return "full";
  if (percent < 10) return "critical";
  if (percent < 20) return "low";
  return "normal";
}

interface EvaluateArgs {
  tank: Tank;
  device: Device;
  levelPercent: number;
  volumeLiters: number;
  temperatureC: number | null;
  waterLevelMm: number | null;
  config: EngineConfig;
  ts: string;
  decision: MovementDecision;
}

function evaluateTankAlerts(args: EvaluateArgs): Alert[] {
  const { tank, device, levelPercent, volumeLiters, temperatureC, waterLevelMm, config, ts, decision } = args;
  const created: Alert[] = [];

  const push = (input: Parameters<typeof createAlert>[0]) => {
    const alert = createAlert(input);
    created.push(alert);
    createNotification({
      organizationId: tank.organizationId,
      alertId: alert.id,
      title: alert.title,
      body: alert.message,
      severity: alert.severity,
    });
    return alert;
  };

  // Level alerts -----------------------------------------------------------
  if (levelPercent < tank.criticalThresholdPct) {
    const existing = activeAlertsForTank(tank.id, "critical_fuel");
    if (existing.length === 0) {
      push({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        type: "critical_fuel",
        severity: "critical",
        title: `${tank.name} critically low`,
        message: `Fuel level is below ${tank.criticalThresholdPct}%. Current level: ${Math.round(volumeLiters).toLocaleString()} L (${levelPercent.toFixed(1)}%).`,
        value: volumeLiters,
        unit: "L",
        threshold: tank.criticalThresholdPct,
        metadata: { levelPercent: Number(levelPercent.toFixed(2)), ts },
      });
    }
  } else if (levelPercent < tank.lowThresholdPct) {
    const existing = activeAlertsForTank(tank.id, "low_fuel");
    if (existing.length === 0) {
      push({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        type: "low_fuel",
        severity: "warning",
        title: `${tank.name} low fuel`,
        message: `Fuel level has dropped below ${tank.lowThresholdPct}%. Current level: ${Math.round(volumeLiters).toLocaleString()} L (${levelPercent.toFixed(1)}%).`,
        value: volumeLiters,
        unit: "L",
        threshold: tank.lowThresholdPct,
        metadata: { levelPercent: Number(levelPercent.toFixed(2)), ts },
      });
    }
  } else {
    // Recovered — auto-resolve stale low/critical alerts.
    for (const type of ["low_fuel", "critical_fuel"]) {
      for (const alert of activeAlertsForTank(tank.id, type)) {
        if (levelPercent >= tank.lowThresholdPct) {
          updateAlertResolved(alert.id, "Level recovered above the low threshold");
        }
      }
    }
  }

  // Overfill ---------------------------------------------------------------
  if (levelPercent > tank.overfillThresholdPct) {
    if (activeAlertsForTank(tank.id, "overfill").length === 0) {
      push({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        type: "overfill",
        severity: "critical",
        title: `${tank.name} overfill risk`,
        message: `Fuel level is at ${levelPercent.toFixed(1)}% — above the configured overfill threshold of ${tank.overfillThresholdPct}%.`,
        value: levelPercent,
        unit: "%",
        threshold: tank.overfillThresholdPct,
        metadata: { ts },
      });
    }
  }

  // Water ------------------------------------------------------------------
  if (waterLevelMm != null && waterLevelMm >= config.waterAlarmMm) {
    if (activeAlertsForTank(tank.id, "water_detected").length === 0) {
      push({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        type: "water_detected",
        severity: "warning",
        title: `Water detected in ${tank.name}`,
        message: `Probe reports a water level of ${waterLevelMm.toFixed(0)} mm. Water ingress affects fuel quality and measurement accuracy.`,
        value: waterLevelMm,
        unit: "mm",
        threshold: config.waterAlarmMm,
        metadata: { ts },
      });
    }
  }

  // Temperature ------------------------------------------------------------
  if (temperatureC != null && (temperatureC < config.temperatureMinC || temperatureC > config.temperatureMaxC)) {
    if (activeAlertsForTank(tank.id, "temperature_abnormal").length === 0) {
      push({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        type: "temperature_abnormal",
        severity: "warning",
        title: `${tank.name} temperature abnormal`,
        message: `Reported temperature ${temperatureC.toFixed(1)} °C is outside the expected range (${config.temperatureMinC} °C to ${config.temperatureMaxC} °C).`,
        value: temperatureC,
        unit: "°C",
        threshold: config.temperatureMaxC,
        metadata: { ts },
      });
    }
  }

  // Suspected fuel loss ----------------------------------------------------
  if (decision.kind === "anomaly" && decision.delta < 0) {
    if (activeAlertsForTank(tank.id, "suspected_loss").length === 0) {
      push({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        type: "suspected_loss",
        severity: "critical",
        title: `Suspected fuel loss — ${tank.name}`,
        message: `${Math.abs(decision.delta).toFixed(0)} L left ${tank.name} in ${decision.minutes.toFixed(1)} minutes (${Math.round(decision.ratePerMinute)} L/min). ${decision.reason ?? ""}`,
        value: Math.abs(decision.delta),
        unit: "L",
        metadata: {
          ts,
          drop: Math.abs(decision.delta),
          minutes: Number(decision.minutes.toFixed(2)),
          ratePerMinute: Math.round(decision.ratePerMinute),
          levelAfter: volumeLiters,
          reason: decision.reason,
        },
      });
    }
  }

  return created;
}

function updateAlertResolved(alertId: string, note: string): void {
  execute("UPDATE alerts SET status = 'resolved', resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), resolution_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", [
    note,
    alertId,
  ]);
}

function flagInvalidReading(device: Device, tank: Tank, reason: string): void {
  createAlert({
    organizationId: tank.organizationId,
    stationId: tank.stationId,
    tankId: tank.id,
    deviceId: device.id,
    type: "invalid_reading",
    severity: "warning",
    title: `Invalid reading from ${device.serialNumber}`,
    message: `A reading from ${device.serialNumber} on ${tank.name} was rejected: ${reason}. The reading was not included in reporting.`,
    metadata: { reason, at: nowIso() },
  });
  updateDevice(device.id, { status: "fault" });
}

function notifyEvent(
  device: Device,
  tank: Tank,
  event: { id: string; type: string; volume: number },
  levelPercent: number,
): void {
  const station = getStation(tank.stationId);
  const stationName = station?.name ?? "Unknown station";
  if (event.type === "anomaly") {
    createNotification({
      organizationId: tank.organizationId,
      title: `Suspected fuel loss — ${tank.name}`,
      body: `${Math.round(event.volume)} L unexplained movement at ${stationName}.`,
      severity: "critical",
    });
    return;
  }
  if (event.type === "refill") {
    createNotification({
      organizationId: tank.organizationId,
      title: `Refill detected — ${tank.name}`,
      body: `+${Math.round(event.volume).toLocaleString()} L received at ${stationName}. Tank now ${levelPercent.toFixed(0)}% full.`,
      severity: "info",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Device health sweep                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Marks devices offline when they stop communicating (PRD §66) and restores
 * them automatically when data returns. Records outage duration in metadata.
 */
export function sweepDeviceHealth(orgId: string): { offline: number; restored: number } {
  const settings = getSettings(orgId);
  const config = { ...DEFAULT_CONFIG, ...((settings.engine ?? {}) as Partial<EngineConfig>) };
  const thresholdIso = new Date(Date.now() - config.deviceOfflineMinutes * 60_000).toISOString();

  const stale = query<Record<string, unknown>>(
    `SELECT * FROM devices WHERE organization_id = ? AND is_active = 1 AND status != 'never_connected'
       AND (last_seen_at IS NULL OR last_seen_at < ?)`,
    [orgId, thresholdIso],
  );

  let offline = 0;
  for (const row of stale) {
    const deviceId = String(row.id);
    const alreadyOffline = String(row.status) === "offline";
    updateDevice(deviceId, { status: "offline" });
    const tankId = row.tank_id ? String(row.tank_id) : null;
    if (tankId) {
      const tank = getTank(tankId);
      if (tank) updateTank(tankId, { status: "offline" });
    }
    if (!alreadyOffline) {
      offline += 1;
      const device = getDevice(deviceId)!;
      const tank = tankId ? getTank(tankId) : null;
      const station = tank ? getStation(tank.stationId) : row.station_id ? getStation(String(row.station_id)) : null;
      const lastSeen = row.last_seen_at ? new Date(String(row.last_seen_at)) : null;
      const outageMinutes = lastSeen ? Math.round((Date.now() - lastSeen.getTime()) / 60000) : null;
      createAlert({
        organizationId: orgId,
        stationId: station?.id ?? (tank?.stationId ?? ""),
        tankId: tank?.id ?? null,
        deviceId,
        type: device.type === "fuel_probe" ? "probe_offline" : "gps_offline",
        severity: "warning",
        title: `${device.type === "fuel_probe" ? "Probe" : "GPS device"} offline — ${device.serialNumber}`,
        message: `No data received for ${outageMinutes ?? config.deviceOfflineMinutes} minutes${tank ? ` from ${tank.name}` : ""}. Last valid reading is being preserved and shown with a stale timestamp.`,
        value: outageMinutes,
        unit: "min",
        threshold: config.deviceOfflineMinutes,
        metadata: { deviceSerial: device.serialNumber, lastSeenAt: row.last_seen_at ?? null },
      });
    }
  }

  // Auto-restore: any device that has been marked offline but is now stale-free
  const restored = query<Record<string, unknown>>(
    `SELECT id FROM devices WHERE organization_id = ? AND status = 'offline' AND last_seen_at IS NOT NULL AND last_seen_at >= ?`,
    [orgId, thresholdIso],
  );
  let restoredCount = 0;
  for (const row of restored) {
    const device = getDevice(String(row.id));
    if (!device) continue;
    updateDevice(device.id, { status: "online" });
    if (device.tankId) {
      const tank = getTank(device.tankId);
      if (tank) {
        const percent = tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0;
        updateTank(tank.id, { status: tankStatusFromPercent(percent) });
      }
    }
    resolveAlertsOfType(device.id, device.type === "fuel_probe" ? "probe_offline" : "gps_offline", "Device communication restored");
    restoredCount += 1;
  }

  return { offline, restored: restoredCount };
}

function resolveAlertsOfType(deviceId: string, type: string, note: string): void {
  const alerts = query<{ id: string }>(
    "SELECT id FROM alerts WHERE device_id = ? AND type = ? AND status != 'resolved'",
    [deviceId, type],
  );
  for (const alert of alerts) {
    execute(
      "UPDATE alerts SET status = 'resolved', resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), resolution_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
      [note, alert.id],
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reconciliation (PRD §39)                                                   */
/* -------------------------------------------------------------------------- */

export interface ReconciliationResult {
  openingStock: number;
  refills: number;
  consumption: number;
  expectedClosing: number;
  measured: number;
  variance: number;
  variancePct: number;
  exceedsThreshold: boolean;
}

export function reconcileTank(
  tankId: string,
  from: string,
  to: string,
  variancePct = DEFAULT_CONFIG.reconciliationVariancePct,
): ReconciliationResult {
  const openingRow = queryOne<{ v: number }>(
    "SELECT volume_liters AS v FROM readings WHERE tank_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    [tankId, from],
  );
  const closingRow = queryOne<{ v: number }>(
    "SELECT volume_liters AS v FROM readings WHERE tank_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    [tankId, to],
  );
  const totals = queryOne<Record<string, number>>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'refill' THEN volume ELSE 0 END), 0) AS refills,
       COALESCE(SUM(CASE WHEN type = 'consumption' THEN volume ELSE 0 END), 0) AS consumption
     FROM fuel_events WHERE tank_id = ? AND ts >= ? AND ts <= ?`,
    [tankId, from, to],
  );
  const openingStock = Number(openingRow?.v ?? 0);
  const measured = Number(closingRow?.v ?? 0);
  const refills = Number(totals?.refills ?? 0);
  const consumption = Number(totals?.consumption ?? 0);
  const expectedClosing = openingStock + refills - consumption;
  const variance = measured - expectedClosing;
  const variancePctActual = expectedClosing > 0 ? (variance / expectedClosing) * 100 : 0;
  return {
    openingStock,
    refills,
    consumption,
    expectedClosing,
    measured,
    variance,
    variancePct: Number(variancePctActual.toFixed(2)),
    exceedsThreshold: Math.abs(variancePctActual) > variancePct,
  };
}

/* -------------------------------------------------------------------------- */
/* Stock coverage (PRD §38)                                                   */
/* -------------------------------------------------------------------------- */

export function stockCoverage(tankId: string, days = 7): { avgDailyConsumption: number; daysRemaining: number | null } {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const row = queryOne<Record<string, number>>(
    `SELECT COALESCE(SUM(volume), 0) AS total FROM fuel_events WHERE tank_id = ? AND type = 'consumption' AND ts >= ?`,
    [tankId, from],
  );
  const avgDaily = Number(row?.total ?? 0) / days;
  const tank = getTank(tankId);
  if (!tank || avgDaily <= 0) return { avgDailyConsumption: avgDaily, daysRemaining: null };
  return { avgDailyConsumption: avgDaily, daysRemaining: tank.currentVolume / avgDaily };
}

export { DEFAULT_CONFIG as engineDefaults };
