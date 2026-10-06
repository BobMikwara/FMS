import { query, queryOne, execute, nowIso, transaction } from "../db/client";
import {
  acknowledgeAlert,
  activeAlertsForTank,
  createAlert,
  latestAlertForRule,
  listEnabledRules,
} from "../db/repo/alerts";
import { createEvent } from "../db/repo/events";
import { insertReadingOnce, latestReadingForTank, readingForDeviceAt } from "../db/repo/readings";
import { getDevice, getDeviceBySerial, getVehicle, lockDeviceForUpdate, updateDevice } from "../db/repo/devices";
import { getTank, getStation, lockTankForUpdate, updateTank } from "../db/repo/stations";
import { getOrganization, getSetting, getSettings } from "../db/repo/core";
import { dispatchStationNotification, notifyAlert } from "../services/notification-dispatch";
import { resolveOperationalEngineSettings } from "../domain/system-config";
import type { Alert, AlertRule, Device, Reading, Tank } from "../domain/types";
import { dayStartInTimeZone, minuteOfDayInTimeZone } from "../services/time-zone";

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
  duplicate?: boolean;
  rejected?: "unknown_device" | "unassigned_device" | "inactive_device" | "invalid_reading" | "duplicate";
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

async function loadConfig(orgId: string): Promise<EngineConfig> {
  const settings = await getSettings(orgId);
  const stored = (settings.engine ?? {}) as Partial<EngineConfig>;
  const operational = resolveOperationalEngineSettings(settings);
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    deviceOfflineMinutes: operational.deviceOfflineMinutes,
    deviceDelayedSeconds: operational.deviceDelayedSeconds,
    reconciliationVariancePct: operational.reconciliationVariancePct,
  };
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
  const timestampText = typeof reading.ts === "string" ? reading.ts.trim() : "";
  const hasTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(timestampText);
  const timestamp = hasTimezone ? Date.parse(timestampText) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: "Reading timestamp must be a valid ISO-8601 date with a timezone" };
  }
  const calendarDate = timestampText.slice(0, 10);
  if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) {
    return { valid: false, reason: "Reading timestamp contains an invalid calendar date" };
  }
  if (timestamp < Date.UTC(2000, 0, 1)) {
    return { valid: false, reason: "Reading timestamp is earlier than the supported telemetry range" };
  }
  if (timestamp > Date.now() + 5 * 60_000) {
    return { valid: false, reason: "Reading timestamp is more than five minutes in the future" };
  }
  if (reading.volumeLiters == null || !Number.isFinite(reading.volumeLiters)) {
    return { valid: false, reason: "Reading contains no finite volume measurement" };
  }
  if (reading.volumeLiters < 0) {
    return { valid: false, reason: `Negative volume reported (${reading.volumeLiters} L)` };
  }
  if (!Number.isFinite(tank.capacity) || tank.capacity <= 0) {
    return { valid: false, reason: "Assigned tank has no valid capacity" };
  }
  // Allow a small tolerance above capacity for sensor noise, but reject nonsense.
  if (reading.volumeLiters > tank.capacity * 1.05) {
    return {
      valid: false,
      reason: `Reported volume ${Math.round(reading.volumeLiters)} L exceeds tank capacity ${Math.round(tank.capacity)} L`,
    };
  }
  const boundedOptionalValues: Array<[string, number | null | undefined, number, number, string]> = [
    ["level percentage", reading.levelPercent, 0, 105, "%"],
    ["level height", reading.levelMm, 0, 100_000, "mm"],
    ["temperature", reading.temperatureC, -40, 90, "°C"],
    ["water level", reading.waterLevelMm, 0, 100_000, "mm"],
    ["signal strength", reading.signal, -140, 100, "dBm / %"],
    ["battery percentage", reading.batteryPct, 0, 100, "%"],
  ];
  for (const [label, value, minimum, maximum, unit] of boundedOptionalValues) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      return { valid: false, reason: `Implausible ${label} (${value} ${unit})` };
    }
  }
  if (reading.raw != null) {
    if (typeof reading.raw !== "object" || Array.isArray(reading.raw)) {
      return { valid: false, reason: "Raw telemetry payload must be a JSON object" };
    }
    try {
      if (JSON.stringify(reading.raw).length > 65_536) {
        return { valid: false, reason: "Raw telemetry payload exceeds the 64 KiB limit" };
      }
    } catch {
      return { valid: false, reason: "Raw telemetry payload is not serializable JSON" };
    }
  }
  return { valid: true };
}

/* -------------------------------------------------------------------------- */
/* Operating hours                                                            */
/* -------------------------------------------------------------------------- */

export function isWithinOperatingHours(
  station: { openingTime: string; closingTime: string; timezone?: string },
  at: Date,
): boolean {
  const minutes = minuteOfDayInTimeZone(at, station.timezone ?? "Africa/Dar_es_Salaam");
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

export async function ingestReading(options: IngestOptions): Promise<IngestResult> {
  return (await transaction(() => ingestReadingInTransaction(options)));
}

export async function flagInvalidTelemetry(deviceId: string, reason: string): Promise<void> {
  await transaction(async () => {
    const foundDevice = await getDevice(deviceId);
    if (!foundDevice) return;
    await lockDeviceForUpdate(foundDevice.id);
    const device = await getDevice(foundDevice.id);
    if (!device || !device.isActive || device.type !== "fuel_probe" || !device.tankId) return;

    const tank = await lockTankForUpdate(device.tankId);
    if (!tank || tank.isArchived || tank.organizationId !== device.organizationId) return;
    const station = await getStation(tank.stationId);
    if (!station || station.isArchived || station.organizationId !== device.organizationId) return;

    const safeReason = reason.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 300) || "Invalid telemetry payload";
    await flagInvalidReading(device, tank, safeReason);
  });
}

async function ingestReadingInTransaction(options: IngestOptions): Promise<IngestResult> {
  const foundDevice: Device | null = options.deviceId
    ? (await getDevice(options.deviceId))
    : options.deviceSerial
      ? (await getDeviceBySerial(options.deviceSerial))
      : null;

  if (!foundDevice) {
    return { ok: false, rejected: "unknown_device", message: "Unrecognised device serial number" };
  }
  // Serialize ingestion against device retirement and reassignment before
  // trusting its current tank assignment.
  await lockDeviceForUpdate(foundDevice.id);
  const device = await getDevice(foundDevice.id);
  if (!device) return { ok: false, rejected: "unknown_device", message: "Unrecognised device serial number" };
  if (!device.isActive) {
    return { ok: false, rejected: "inactive_device", message: "This device has been retired and can no longer submit readings." };
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

  // Lock the tank row before reading the previous point. This serializes
  // concurrent PostgreSQL ingests for this tank; SQLite uses BEGIN IMMEDIATE.
  const tank = await lockTankForUpdate(device.tankId);
  if (!tank) {
    return { ok: false, rejected: "unassigned_device", message: "Assigned tank no longer exists" };
  }
  const station = await getStation(tank.stationId);
  if (!station) {
    return { ok: false, rejected: "unassigned_device", message: "Assigned station no longer exists" };
  }
  if (tank.organizationId !== device.organizationId || station.organizationId !== device.organizationId) {
    return { ok: false, rejected: "unassigned_device", message: "The assigned device, tank and station must belong to the same organization." };
  }
  if (tank.isArchived || station.isArchived) {
    return { ok: false, rejected: "unassigned_device", message: "The assigned tank or station has been archived; telemetry is no longer accepted." };
  }

  const timestamp = Date.parse(options.reading.ts);
  const ts = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : options.reading.ts;
  const normalizedReading = { ...options.reading, ts };
  const validation = validateReading(tank, normalizedReading);
  if (!validation.valid) {
    (await flagInvalidReading(device, tank, validation.reason ?? "Invalid reading"));
    return { ok: false, rejected: "invalid_reading", message: validation.reason };
  }

  const volumeLiters = normalizedReading.volumeLiters as number;
  const capacity = tank.capacity;
  const levelPercent = normalizedReading.levelPercent ?? (volumeLiters / capacity) * 100;
  const readingInput = {
    ts,
    organizationId: tank.organizationId,
    tankId: tank.id,
    deviceId: device.id,
    volumeLiters,
    levelPercent,
    levelMm: normalizedReading.levelMm ?? null,
    temperatureC: normalizedReading.temperatureC ?? null,
    waterLevelMm: normalizedReading.waterLevelMm ?? null,
    signal: normalizedReading.signal ?? device.signalStrength ?? null,
    batteryPct: normalizedReading.batteryPct ?? device.batteryPct ?? null,
    raw: normalizedReading.raw ?? null,
  };

  const existingAtTimestamp = await readingForDeviceAt(device.id, ts);
  if (existingAtTimestamp) {
    if (sameTelemetry(existingAtTimestamp, normalizedReading, levelPercent)) {
      return { ok: true, duplicate: true, reading: existingAtTimestamp, event: null, alerts: [] };
    }
    return {
      ok: false,
      rejected: "duplicate",
      message: "A different reading already exists for this device at the same timestamp",
    };
  }

  const previous = await latestReadingForTank(tank.id);
  // Reject back-dated payloads before inserting them into the live history.
  if (previous && timestamp < new Date(previous.ts).getTime()) {
    return { ok: false, rejected: "duplicate", message: "Reading timestamp is older than the latest stored reading" };
  }

  const config = await loadConfig(tank.organizationId);
  const inserted = await insertReadingOnce(readingInput);
  if (!inserted.inserted) {
    if (sameTelemetry(inserted.reading, normalizedReading, levelPercent)) {
      return { ok: true, duplicate: true, reading: inserted.reading, event: null, alerts: [] };
    }
    return {
      ok: false,
      rejected: "duplicate",
      message: "A different reading already exists for this device at the same timestamp",
    };
  }
  const reading = inserted.reading;

  const at = new Date(ts);
  const withinHours = isWithinOperatingHours(station, at);
  const decision = classifyMovement({
    previous,
    next: { ...normalizedReading, volumeLiters, ts },
    config,
    withinOperatingHours: withinHours,
  });

  const tankPatch: Record<string, unknown> = {
    currentVolume: volumeLiters,
    lastReadingAt: ts,
    lastValidReadingAt: ts,
    currentTempC: normalizedReading.temperatureC ?? tank.currentTempC,
    currentLevelMm: normalizedReading.levelMm ?? tank.currentLevelMm,
    waterLevelMm: normalizedReading.waterLevelMm ?? tank.waterLevelMm,
    status: tankStatusFromPercent(levelPercent, tank),
  };
  (await updateTank(tank.id, tankPatch));

  const devicePatch: Record<string, unknown> = {
    status: "online",
    lastSeenAt: ts,
    lastReadingAt: ts,
  };
  if (normalizedReading.signal != null) devicePatch.signalStrength = normalizedReading.signal;
  if (normalizedReading.batteryPct != null) devicePatch.batteryPct = normalizedReading.batteryPct;
  (await updateDevice(device.id, devicePatch));
  if (device.status === "offline" || device.status === "fault") {
    await resolveAlertsOfType(device.id, "probe_offline", "Valid fuel-probe reading received");
  }
  if (device.status === "fault") {
    await resolveAlertsOfType(device.id, "invalid_reading", "A subsequent valid reading was received");
  }

  let event: { id: string; type: string; volume: number; delta: number } | null = null;
  const alerts: Alert[] = [];

  if (decision.kind !== "none") {
    const created = (await createEvent({
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
    }));
    event = { id: created.id, type: created.type, volume: created.volume, delta: decision.delta };
  }

  alerts.push(
    ...(await evaluateTankAlerts({
      tank,
      device,
      levelPercent,
      volumeLiters,
      temperatureC: normalizedReading.temperatureC ?? null,
      waterLevelMm: normalizedReading.waterLevelMm ?? null,
      config,
      ts,
      decision,
    })),
  );

  if (event && (event.type === "anomaly" || event.type === "refill")) {
    const relatedAlertType = event.type === "anomaly" ? "suspected_loss" : "refill";
    const alertAlreadyNotified = alerts.some((alert) => alert.type === relatedAlertType);
    if (!alertAlreadyNotified) await notifyEvent(device, tank, event, levelPercent);
  }

  return { ok: true, duplicate: false, reading, event, alerts };
}

function sameTelemetry(
  existing: Reading,
  candidate: NormalizedReading,
  levelPercent: number,
): boolean {
  if (existing.volumeLiters !== candidate.volumeLiters) return false;
  if (candidate.levelPercent != null && existing.levelPercent !== levelPercent) return false;
  if (candidate.levelMm != null && existing.levelMm !== candidate.levelMm) return false;
  if (candidate.temperatureC != null && existing.temperatureC !== candidate.temperatureC) return false;
  if (candidate.waterLevelMm != null && existing.waterLevelMm !== candidate.waterLevelMm) return false;
  if (candidate.signal != null && existing.signal !== candidate.signal) return false;
  if (candidate.batteryPct != null && existing.batteryPct !== candidate.batteryPct) return false;
  return true;
}

async function createAlertAndNotify(input: Parameters<typeof createAlert>[0]): Promise<Alert> {
  const alert = await createAlert(input);
  await notifyAlert(alert);
  return alert;
}

/* -------------------------------------------------------------------------- */
/* Alert evaluation                                                           */
/* -------------------------------------------------------------------------- */

export function tankStatusFromPercent(
  percent: number,
  tank: Pick<Tank, "criticalThresholdPct" | "lowThresholdPct" | "overfillThresholdPct">,
): Tank["status"] {
  if (percent >= tank.overfillThresholdPct) return "full";
  if (percent < tank.criticalThresholdPct) return "critical";
  if (percent < tank.lowThresholdPct) return "low";
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

function ruleNumber(rule: AlertRule, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = rule.condition[key];
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  const rawLegacyValue = rule.condition.value;
  if (rawLegacyValue == null || rawLegacyValue === "") return fallback;
  const legacyValue = Number(rawLegacyValue);
  return Number.isFinite(legacyValue) ? legacyValue : fallback;
}

function isBelowThreshold(value: number, threshold: number, operator?: unknown): boolean {
  return operator === "<=" ? value <= threshold : value < threshold;
}

function isAboveThreshold(value: number, threshold: number, operator?: unknown): boolean {
  return operator === ">" ? value > threshold : value >= threshold;
}

function ruleTargetsTank(rule: AlertRule, tank: Tank, device: Device): boolean {
  if (rule.organizationId !== tank.organizationId) return false;
  if (rule.fuelTypeId && rule.fuelTypeId !== tank.fuelTypeId) return false;
  switch (rule.scope) {
    case "organization":
      return true;
    case "station":
      return rule.stationId === tank.stationId;
    case "tank":
      return rule.tankId == null || rule.tankId === tank.id;
    case "device":
      return rule.deviceId === device.id;
    default:
      return false;
  }
}

async function evaluateTankAlerts(args: EvaluateArgs): Promise<Alert[]> {
  const { tank, device, levelPercent, volumeLiters, temperatureC, waterLevelMm, config, ts, decision } = args;
  const created: Alert[] = [];
  const rules = (await listEnabledRules(tank.organizationId)).filter((rule) => ruleTargetsTank(rule, tank, device));
  const configuredTypes = new Set(rules.map((rule) => rule.type));

  const push = async (input: Parameters<typeof createAlert>[0]) => {
    const alert = await createAlertAndNotify(input);
    created.push(alert);
    return alert;
  };

  const resolveConfiguredRule = async (rule: AlertRule, note: string) => {
    const last = await latestAlertForRule(rule.id, tank.id);
    if (last && last.status !== "resolved") await updateAlertResolved(last.id, note);
  };

  const pushConfigured = async (
    rule: AlertRule,
    measurement: { value: number; unit: string; threshold: number; description: string },
    eventOnly = false,
  ) => {
    const sameTypeActive = await activeAlertsForTank(tank.id, rule.type);
    if (sameTypeActive.some((alert) => alert.ruleId == null || (!eventOnly && alert.ruleId === rule.id))) return;
    const last = await latestAlertForRule(rule.id, tank.id);
    if (last) {
      if (!eventOnly && last.status !== "resolved") return;
      const ageMs = Date.now() - Date.parse(last.createdAt);
      if (ageMs >= 0 && ageMs < Math.max(0, rule.cooldownMin) * 60_000) return;
    }
    const description = rule.description ? `${rule.description} ` : "";
    await push({
      organizationId: tank.organizationId,
      stationId: tank.stationId,
      tankId: tank.id,
      deviceId: device.id,
      ruleId: rule.id,
      type: rule.type,
      severity: rule.severity,
      title: rule.name,
      message: `${description}${measurement.description} Configured threshold: ${measurement.threshold} ${measurement.unit}.`,
      value: measurement.value,
      unit: measurement.unit,
      threshold: measurement.threshold,
      metadata: {
        ts,
        condition: rule.condition,
        levelPercent: Number(levelPercent.toFixed(2)),
        volumeLiters: Number(volumeLiters.toFixed(2)),
      },
    });
  };

  // User-configured rules are authoritative for their type and target; built-in
  // thresholds remain as a safe default for types without a matching rule.
  for (const rule of rules) {
    const condition = rule.condition;
    switch (rule.type) {
      case "refill": {
        const threshold = ruleNumber(rule, ["liters", "volumeLiters"], config.refillThresholdLiters);
        if ((decision.kind === "refill" || decision.kind === "none") && decision.delta > 0 && isAboveThreshold(decision.delta, threshold, condition.operator)) {
          await pushConfigured(rule, {
            value: decision.delta,
            unit: "L",
            threshold,
            description: `A confirmed ${decision.delta.toFixed(1)} L refill was detected.`,
          }, true);
        }
        break;
      }
      case "low_fuel":
      case "critical_fuel": {
        const fallback = rule.type === "critical_fuel" ? tank.criticalThresholdPct : tank.lowThresholdPct;
        const threshold = ruleNumber(rule, ["percent"], fallback);
        if (isBelowThreshold(levelPercent, threshold, condition.operator)) {
          await pushConfigured(rule, {
            value: levelPercent,
            unit: "%",
            threshold,
            description: `Tank level is ${levelPercent.toFixed(1)}%.`,
          });
        }
        break;
      }
      case "high_fuel":
      case "overfill": {
        const fallback = tank.overfillThresholdPct;
        const threshold = ruleNumber(rule, ["percent"], fallback);
        if (isAboveThreshold(levelPercent, threshold, condition.operator)) {
          await pushConfigured(rule, {
            value: levelPercent,
            unit: "%",
            threshold,
            description: `Tank level is ${levelPercent.toFixed(1)}%.`,
          });
        } else {
          await resolveConfiguredRule(rule, "Tank level returned below the configured threshold");
        }
        break;
      }
      case "water_detected": {
        const threshold = ruleNumber(rule, ["mm"], config.waterAlarmMm);
        if (waterLevelMm != null && isAboveThreshold(waterLevelMm, threshold, condition.operator)) {
          await pushConfigured(rule, {
            value: waterLevelMm,
            unit: "mm",
            threshold,
            description: `Probe reports ${waterLevelMm.toFixed(1)} mm of water.`,
          });
        } else if (waterLevelMm != null) {
          await resolveConfiguredRule(rule, "Water level returned below the configured threshold");
        }
        break;
      }
      case "high_temperature": {
        const threshold = ruleNumber(rule, ["celsius"], config.temperatureMaxC);
        if (temperatureC != null && isAboveThreshold(temperatureC, threshold, condition.operator)) {
          await pushConfigured(rule, {
            value: temperatureC,
            unit: "°C",
            threshold,
            description: `Probe reports a temperature of ${temperatureC.toFixed(1)} °C.`,
          });
        } else if (temperatureC != null) {
          await resolveConfiguredRule(rule, "Temperature returned below the configured threshold");
        }
        break;
      }
      case "temperature_abnormal": {
        const range = Array.isArray(condition.value) ? condition.value.map(Number) : null;
        const minimum = range && range.length === 2 ? range[0] : config.temperatureMinC;
        const maximum = range && range.length === 2 ? range[1] : ruleNumber(rule, ["celsius"], config.temperatureMaxC);
        const abnormal = temperatureC != null && (temperatureC < minimum || temperatureC > maximum);
        if (abnormal && temperatureC != null) {
          const threshold = temperatureC < minimum ? minimum : maximum;
          await pushConfigured(rule, {
            value: temperatureC,
            unit: "°C",
            threshold,
            description: `Probe reports ${temperatureC.toFixed(1)} °C, outside the configured range ${minimum} to ${maximum} °C.`,
          });
        } else if (temperatureC != null) {
          await resolveConfiguredRule(rule, "Temperature returned to the configured range");
        }
        break;
      }
      case "rapid_change": {
        const threshold = ruleNumber(rule, ["litersPerMinute", "ratePerMinute"], config.rapidChangeLitersPerMin);
        const withinWindow = condition.windowMinutes == null || decision.minutes <= ruleNumber(rule, ["windowMinutes"], Number.POSITIVE_INFINITY);
        if (withinWindow && Math.abs(decision.delta) >= config.consumptionMinLiters && isAboveThreshold(decision.ratePerMinute, threshold, condition.operator)) {
          await pushConfigured(rule, {
            value: decision.ratePerMinute,
            unit: "L/min",
            threshold,
            description: `Tank volume changed by ${Math.abs(decision.delta).toFixed(1)} L at ${decision.ratePerMinute.toFixed(1)} L/min.`,
          });
        } else {
          await resolveConfiguredRule(rule, "Tank movement returned below the configured rate threshold");
        }
        break;
      }
      case "suspected_loss": {
        const legacyRateRule = condition.metric === "drop_rate";
        const explicitDropThreshold = condition.liters ?? condition.dropLiters;
        const dropThreshold = explicitDropThreshold == null
          ? (legacyRateRule ? 0 : config.refillThresholdLiters)
          : Number(explicitDropThreshold);
        const rateThreshold = legacyRateRule
          ? ruleNumber(rule, ["litersPerMinute", "ratePerMinute", "value"], config.rapidChangeLitersPerMin)
          : (condition.litersPerMinute == null && condition.ratePerMinute == null
            ? null
            : ruleNumber(rule, ["litersPerMinute", "ratePerMinute"], config.rapidChangeLitersPerMin));
        const primaryMeasurement = legacyRateRule ? decision.ratePerMinute : Math.abs(decision.delta);
        const primaryThreshold = legacyRateRule ? rateThreshold : dropThreshold;
        const primaryConditionMet = primaryThreshold != null &&
          isAboveThreshold(primaryMeasurement, primaryThreshold, condition.operator);
        const rateConditionMet = legacyRateRule || rateThreshold == null ||
          isAboveThreshold(decision.ratePerMinute, rateThreshold);
        const withinWindow = condition.windowMinutes == null ||
          decision.minutes <= ruleNumber(rule, ["windowMinutes"], Number.POSITIVE_INFINITY);
        if (
          withinWindow &&
          decision.kind === "anomaly" &&
          decision.delta < 0 &&
          primaryConditionMet &&
          rateConditionMet
        ) {
          await pushConfigured(rule, {
            value: primaryMeasurement,
            unit: legacyRateRule ? "L/min" : "L",
            threshold: primaryThreshold ?? dropThreshold,
            description: legacyRateRule
              ? `An unexplained ${Math.abs(decision.delta).toFixed(1)} L decrease was detected at ${decision.ratePerMinute.toFixed(1)} L/min in ${decision.minutes.toFixed(1)} minutes.`
              : `An unexplained ${Math.abs(decision.delta).toFixed(1)} L decrease was detected in ${decision.minutes.toFixed(1)} minutes.`,
          });
        }
        break;
      }
      case "invalid_reading":
      case "reconciliation_variance":
      case "probe_offline":
      case "gps_offline":
        // These rules are evaluated by their respective reconciliation and
        // device-health workflows, not by a single fuel sample.
        break;
      default:
        break;
    }
  }

  // Tank level alerts ------------------------------------------------------
  if (!configuredTypes.has("critical_fuel") && levelPercent < tank.criticalThresholdPct) {
    if ((await activeAlertsForTank(tank.id, "critical_fuel")).length === 0) {
      await push({
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
  } else if (!configuredTypes.has("low_fuel") && levelPercent < tank.lowThresholdPct) {
    if ((await activeAlertsForTank(tank.id, "low_fuel")).length === 0) {
      await push({
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
  }
  for (const type of ["low_fuel", "critical_fuel"]) {
    for (const alert of await activeAlertsForTank(tank.id, type)) {
      const linkedRule = alert.ruleId ? rules.find((rule) => rule.id === alert.ruleId) : undefined;
      const recoveryThreshold = alert.ruleId
        ? (alert.threshold ?? tank.lowThresholdPct)
        : (type === "critical_fuel" ? tank.lowThresholdPct : (alert.threshold ?? tank.lowThresholdPct));
      const recovered = linkedRule?.condition.operator === "<="
        ? levelPercent > recoveryThreshold
        : levelPercent >= recoveryThreshold;
      if (recovered) {
        await updateAlertResolved(alert.id, "Level recovered above the configured threshold");
      }
    }
  }

  // Built-in fallbacks for conditions that do not have a matching rule.
  if (!configuredTypes.has("overfill") && levelPercent > tank.overfillThresholdPct) {
    if ((await activeAlertsForTank(tank.id, "overfill")).length === 0) {
      await push({
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
  } else if (!configuredTypes.has("overfill") && levelPercent <= tank.overfillThresholdPct) {
    for (const alert of await activeAlertsForTank(tank.id, "overfill")) {
      if (!alert.ruleId) await updateAlertResolved(alert.id, "Tank level returned below the overfill threshold");
    }
  }
  if (!configuredTypes.has("water_detected") && waterLevelMm != null && waterLevelMm >= config.waterAlarmMm) {
    if ((await activeAlertsForTank(tank.id, "water_detected")).length === 0) {
      await push({
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
  } else if (!configuredTypes.has("water_detected") && (waterLevelMm == null || waterLevelMm < config.waterAlarmMm)) {
    for (const alert of await activeAlertsForTank(tank.id, "water_detected")) {
      if (!alert.ruleId) await updateAlertResolved(alert.id, "Water level returned below the configured threshold");
    }
  }
  const coldTemperatureAlert = temperatureC != null && temperatureC < config.temperatureMinC && !configuredTypes.has("temperature_abnormal");
  const hotTemperatureAlert = temperatureC != null && temperatureC > config.temperatureMaxC && !configuredTypes.has("high_temperature") && !configuredTypes.has("temperature_abnormal");
  if (coldTemperatureAlert || hotTemperatureAlert) {
    if ((await activeAlertsForTank(tank.id, "temperature_abnormal")).length === 0) {
      await push({
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
  } else if (temperatureC != null && temperatureC >= config.temperatureMinC && temperatureC <= config.temperatureMaxC) {
    for (const alert of await activeAlertsForTank(tank.id, "temperature_abnormal")) {
      if (!alert.ruleId) await updateAlertResolved(alert.id, "Temperature returned to the expected range");
    }
  }
  if (!configuredTypes.has("suspected_loss") && decision.kind === "anomaly" && decision.delta < 0) {
    if ((await activeAlertsForTank(tank.id, "suspected_loss")).length === 0) {
      await push({
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

  // A configured reconciliation rule compares a rolling seven-day book balance
  // with the latest measured tank volume. It is evaluated only on ingest, not
  // on page/report reads, so read-only views have no alert side effects.
  const reconciliationRules = rules.filter((rule) => rule.type === "reconciliation_variance");
  if (reconciliationRules.length > 0) {
    const from = new Date(Date.parse(ts) - 7 * 86_400_000).toISOString();
    const reconciliation = await reconcileTank(tank.id, from, ts, 0);
    for (const rule of reconciliationRules) {
      const threshold = ruleNumber(rule, ["percent"], config.reconciliationVariancePct);
      if (isAboveThreshold(Math.abs(reconciliation.variancePct), threshold, rule.condition.operator)) {
        await pushConfigured(rule, {
          value: reconciliation.variancePct,
          unit: "%",
          threshold,
          description: `Rolling seven-day measured stock differs from expected stock by ${reconciliation.variancePct.toFixed(2)}%.`,
        });
      } else {
        await resolveConfiguredRule(rule, "Rolling reconciliation variance returned within the configured threshold");
      }
    }
  }

  return created;
}

async function updateAlertResolved(alertId: string, note: string): Promise<void> {
  (await execute("UPDATE alerts SET status = 'resolved', resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), resolution_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", [
    note,
    alertId,
  ]));
}

async function flagInvalidReading(device: Device, tank: Tank, reason: string): Promise<void> {
  const matchingRules = (await listEnabledRules(tank.organizationId))
    .filter((rule) => rule.type === "invalid_reading" && ruleTargetsTank(rule, tank, device));
  const activeAlerts = await activeAlertsForTank(tank.id, "invalid_reading");
  if (matchingRules.length === 0) {
    if (activeAlerts.length === 0) await createAlertAndNotify({
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
  } else {
    for (const rule of matchingRules) {
      if (activeAlerts.some((alert) => alert.ruleId == null || alert.ruleId === rule.id)) continue;
      const last = await latestAlertForRule(rule.id, tank.id);
      if (last) {
        if (last.status !== "resolved") continue;
        const ageMs = Date.now() - Date.parse(last.createdAt);
        if (ageMs >= 0 && ageMs < Math.max(0, rule.cooldownMin) * 60_000) continue;
      }
      await createAlertAndNotify({
        organizationId: tank.organizationId,
        stationId: tank.stationId,
        tankId: tank.id,
        deviceId: device.id,
        ruleId: rule.id,
        type: "invalid_reading",
        severity: rule.severity,
        title: rule.name,
        message: `${rule.description ? `${rule.description} ` : ""}A reading from ${device.serialNumber} on ${tank.name} was rejected: ${reason}.`,
        metadata: { reason, at: nowIso(), condition: rule.condition },
      });
    }
  }
  await updateDevice(device.id, { status: "fault" });
}

async function notifyEvent(
  device: Device,
  tank: Tank,
  event: { id: string; type: string; volume: number; delta: number },
  levelPercent: number,
): Promise<void> {
  const station = await getStation(tank.stationId);
  const stationName = station?.name ?? "Unknown station";
  const common = {
    organizationId: tank.organizationId,
    stationId: tank.stationId,
    alertId: `event:${event.id}`,
    idempotencyKey: `fuel-event:${event.id}`,
    channels: ["in_app"],
  };
  if (event.type === "anomaly") {
    const isPossibleLoss = event.delta < 0;
    await dispatchStationNotification({
      ...common,
      title: isPossibleLoss ? `Suspected fuel loss: ${tank.name}` : `Unusual fuel increase: ${tank.name}`,
      body: isPossibleLoss
        ? `${Math.round(event.volume)} L unexplained decrease at ${stationName}. Review this event before concluding there was a loss.`
        : `${Math.round(event.volume)} L unexplained increase at ${stationName}. Verify whether a delivery was recorded.`,
      severity: isPossibleLoss ? "critical" : "warning",
    });
    return;
  }
  if (event.type === "refill") {
    await dispatchStationNotification({
      ...common,
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
export async function sweepDeviceHealth(orgId: string): Promise<{ offline: number; restored: number }> {
  return (await transaction(() => sweepDeviceHealthInTransaction(orgId)));
}

function ruleTargetsDevice(
  rule: AlertRule,
  device: Device,
  tank: Tank | null,
  stationIds: string[],
): boolean {
  if (rule.organizationId !== device.organizationId) return false;
  if (rule.fuelTypeId && rule.fuelTypeId !== tank?.fuelTypeId) return false;
  switch (rule.scope) {
    case "organization":
      return true;
    case "device":
      return rule.deviceId === device.id;
    case "tank":
      return rule.tankId == null || rule.tankId === tank?.id;
    case "station":
      return Boolean(rule.stationId && stationIds.includes(rule.stationId));
    default:
      return false;
  }
}

export function recoveryAlertTypeForDevice(type: Device["type"]): "probe_offline" | "gps_offline" {
  return type === "fuel_probe" ? "probe_offline" : "gps_offline";
}

export function isDeviceFreshForRecovery(
  lastSeenAt: string | null | undefined,
  offlineTimeoutMinutes: number,
  now = Date.now(),
): boolean {
  if (!lastSeenAt) return false;
  const timestamp = Date.parse(lastSeenAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = now - timestamp;
  return age >= 0 && age <= Math.max(0, offlineTimeoutMinutes) * 60_000;
}

async function sweepDeviceHealthInTransaction(orgId: string): Promise<{ offline: number; restored: number }> {
  const config = await loadConfig(orgId);
  const rules = await listEnabledRules(orgId);
  const offlineRules = rules.filter((rule) => rule.type === "probe_offline" || rule.type === "gps_offline");
  const ruleThresholds = offlineRules.map((rule) => Math.max(1, ruleNumber(rule, ["minutes"], config.deviceOfflineMinutes)));
  const scanMinutes = Math.min(config.deviceOfflineMinutes, ...ruleThresholds);
  const thresholdIso = new Date(Date.now() - scanMinutes * 60_000).toISOString();

  // A never-connected device gets the full outage grace period from registration
  // before it is marked offline; it is not treated as failed on creation.
  // Trackers are health-monitored only after at least one valid GPS fix has
  // been stored. A newly configured tracker without telemetry is not declared
  // offline from its registration timestamp alone.
  const stale = await query<Record<string, unknown>>(
    `SELECT * FROM devices WHERE organization_id = ? AND is_active = 1
       AND (type = 'fuel_probe' OR (type = 'gps_tracker' AND EXISTS (
         SELECT 1 FROM vehicle_positions vp WHERE vp.device_id = devices.id
       )))
       AND ((last_seen_at IS NULL AND created_at < ?) OR (last_seen_at IS NOT NULL AND last_seen_at < ?))`,
    [orgId, thresholdIso, thresholdIso],
  );

  let offline = 0;
  for (const row of stale) {
    const deviceId = String(row.id);
    await lockDeviceForUpdate(deviceId);
    const device = await getDevice(deviceId);
    if (!device || !device.isActive) continue;

    const tank = device.tankId ? await getTank(device.tankId) : null;
    const vehicle = device.vehicleId ? await getVehicle(device.vehicleId) : null;
    const stationIds = [...new Set([
      device.stationId,
      tank?.stationId ?? null,
      vehicle?.stationId ?? null,
    ].filter((stationId): stationId is string => Boolean(stationId)))];
    const stationId = tank?.stationId ?? vehicle?.stationId ?? device.stationId;
    const station = stationId ? await getStation(stationId) : null;
    if (tank?.isArchived || vehicle?.isArchived || station?.isArchived) continue;
    if (tank && tank.organizationId !== orgId) continue;
    if (vehicle && vehicle.organizationId !== orgId) continue;
    if (station && station.organizationId !== orgId) continue;
    const lastActivityAt = device.lastSeenAt ?? device.createdAt;
    const lastActivity = new Date(lastActivityAt);
    const outageMinutes = Number.isFinite(lastActivity.getTime())
      ? Math.max(0, (Date.now() - lastActivity.getTime()) / 60_000)
      : config.deviceOfflineMinutes;
    const alertType = device.type === "fuel_probe" ? "probe_offline" : "gps_offline";
    const matchingRules = offlineRules.filter((rule) =>
      rule.type === alertType && ruleTargetsDevice(rule, device, tank, stationIds),
    );
    const ruleThresholdMet = matchingRules.some((rule) =>
      isAboveThreshold(
        outageMinutes,
        Math.max(1, ruleNumber(rule, ["minutes"], config.deviceOfflineMinutes)),
        rule.condition.operator,
      ),
    );
    if (matchingRules.length > 0 ? !ruleThresholdMet : outageMinutes < config.deviceOfflineMinutes) continue;

    const alreadyOffline = device.status === "offline";
    if (!alreadyOffline) {
      await updateDevice(deviceId, { status: "offline" });
      if (tank) await updateTank(tank.id, { status: "offline" });
      offline += 1;
    }

    const alertMessage = `No data received for ${Math.round(outageMinutes)} minutes${tank ? ` from ${tank.name}` : ""}. Last valid reading is being preserved and shown with a stale timestamp.`;
    if (matchingRules.length > 0) {
      for (const rule of matchingRules) {
        const threshold = Math.max(1, ruleNumber(rule, ["minutes"], config.deviceOfflineMinutes));
        if (!isAboveThreshold(outageMinutes, threshold, rule.condition.operator) || !station) continue;
        const lastAlert = await latestAlertForRule(rule.id, undefined, device.id);
        if (lastAlert && lastAlert.status !== "resolved") continue;
        const ageMs = lastAlert ? Date.now() - Date.parse(lastAlert.createdAt) : Number.POSITIVE_INFINITY;
        if (lastAlert && ageMs >= 0 && ageMs < Math.max(0, rule.cooldownMin) * 60_000) continue;
        await createAlertAndNotify({
          organizationId: orgId,
          stationId: station.id,
          tankId: tank?.id ?? null,
          deviceId,
          ruleId: rule.id,
          type: alertType,
          severity: rule.severity,
          title: rule.name,
          message: `${rule.description ? `${rule.description} ` : ""}${alertMessage} Configured threshold: ${threshold} minutes.`,
          value: outageMinutes,
          unit: "min",
          threshold,
          metadata: { deviceSerial: device.serialNumber, lastSeenAt: device.lastSeenAt, ruleCondition: rule.condition },
        });
      }
    } else if (!alreadyOffline && station) {
      await createAlertAndNotify({
        organizationId: orgId,
        stationId: station.id,
        tankId: tank?.id ?? null,
        deviceId,
        type: alertType,
        severity: "warning",
        title: `${device.type === "fuel_probe" ? "Probe" : "GPS device"} offline — ${device.serialNumber}`,
        message: alertMessage,
        value: outageMinutes,
        unit: "min",
        threshold: config.deviceOfflineMinutes,
        metadata: { deviceSerial: device.serialNumber, lastSeenAt: device.lastSeenAt },
      });
    }
  }

  // Auto-restore: any active device that has reported recently is brought back online.
  const restored = await query<{ id: string }>(
    `SELECT id FROM devices WHERE organization_id = ? AND is_active = 1 AND status = 'offline'
       AND last_seen_at IS NOT NULL AND last_seen_at >= ?
       AND (type = 'fuel_probe' OR (type = 'gps_tracker' AND EXISTS (
         SELECT 1 FROM vehicle_positions vp WHERE vp.device_id = devices.id
       )))`,
    [orgId, thresholdIso],
  );
  let restoredCount = 0;
  for (const row of restored) {
    const deviceId = String(row.id);
    await lockDeviceForUpdate(deviceId);
    const device = await getDevice(deviceId);
    if (!device || !device.isActive || device.status !== "offline") continue;
    if (!isDeviceFreshForRecovery(device.lastSeenAt, config.deviceOfflineMinutes)) continue;
    await updateDevice(device.id, { status: "online" });
    if (device.tankId) {
      const tank = await getTank(device.tankId);
      if (tank) {
        const percent = tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0;
        await updateTank(tank.id, { status: tankStatusFromPercent(percent, tank) });
      }
    }
    await resolveAlertsOfType(device.id, recoveryAlertTypeForDevice(device.type), "Device communication restored");
    restoredCount += 1;
  }

  return { offline, restored: restoredCount };
}

async function resolveAlertsOfType(deviceId: string, type: string, note: string): Promise<void> {
  const alerts = (await query<{ id: string }>(
    "SELECT id FROM alerts WHERE device_id = ? AND type = ? AND status != 'resolved'",
    [deviceId, type],
  ));
  for (const alert of alerts) {
    (await execute(
      "UPDATE alerts SET status = 'resolved', resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), resolution_note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
      [note, alert.id],
    ));
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

export async function reconcileTank(
  tankId: string,
  from: string,
  to: string,
  variancePct = DEFAULT_CONFIG.reconciliationVariancePct,
): Promise<ReconciliationResult> {
  const openingRow = (await queryOne<{ v: number }>(
    "SELECT volume_liters AS v FROM readings WHERE tank_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    [tankId, from],
  ));
  const closingRow = (await queryOne<{ v: number }>(
    "SELECT volume_liters AS v FROM readings WHERE tank_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    [tankId, to],
  ));
  const totals = (await queryOne<Record<string, number>>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'refill' THEN volume ELSE 0 END), 0) AS refills,
       COALESCE(SUM(CASE WHEN type = 'consumption' THEN volume ELSE 0 END), 0) AS consumption
     FROM fuel_events WHERE tank_id = ? AND ts >= ? AND ts <= ?`,
    [tankId, from, to],
  ));
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

export async function stockCoverage(
  tankId: string,
  days = 7,
  timeZone = "Africa/Dar_es_Salaam",
): Promise<{ avgDailyConsumption: number; daysRemaining: number | null }> {
  const windowDays = Math.max(1, Math.floor(days));
  const from = dayStartInTimeZone(new Date(), -(windowDays - 1), timeZone).toISOString();
  const row = (await queryOne<Record<string, number>>(
    `SELECT COALESCE(SUM(volume), 0) AS total FROM fuel_events WHERE tank_id = ? AND type = 'consumption' AND ts >= ?`,
    [tankId, from],
  ));
  const avgDaily = Number(row?.total ?? 0) / windowDays;
  const tank = (await getTank(tankId));
  if (!tank || avgDaily <= 0) return { avgDailyConsumption: avgDaily, daysRemaining: null };
  return { avgDailyConsumption: avgDaily, daysRemaining: tank.currentVolume / avgDaily };
}

export { DEFAULT_CONFIG as engineDefaults };
