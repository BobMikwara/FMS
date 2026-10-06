const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateReading,
  classifyMovement,
  isWithinOperatingHours,
  recoveryAlertTypeForDevice,
  isDeviceFreshForRecovery,
} = require("../src/server/engine/fuel.ts");
const { telemetryFreshness } = require("../src/server/domain/device-freshness.ts");
const { getProvider } = require("../src/server/integrations/providers.ts");
const { tankStateForPercent } = require("../src/lib/status.ts");
const { validateTankThresholds } = require("../src/lib/tank-thresholds.ts");
const { rangeFor } = require("../src/server/services/analytics.ts");
const { resolveOperatorSettings, validateOperationalSettingsPatch } = require("../src/server/domain/system-config.ts");
const { validateScheduleDefinition } = require("../src/server/services/scheduled-report-policy.ts");
const {
  dateFromDateTimeInputInTimeZone,
  dateTimeInputValueInTimeZone,
  dayStartInTimeZone,
  datePartsInTimeZone,
  localBucketKeyInTimeZone,
  normalizeTimeZone,
} = require("../src/server/services/time-zone.ts");

const tank = { capacity: 10_000 };
const baseReading = (patch = {}) => ({
  ts: new Date().toISOString(),
  volumeLiters: 5_000,
  ...patch,
});

const movementConfig = {
  refillThresholdLiters: 120,
  consumptionMinLiters: 5,
  rapidChangeLitersPerMin: 250,
};

function previousReading(volumeLiters, ts = "2026-01-01T12:00:00.000Z") {
  return { volumeLiters, ts };
}

test("reading validation rejects invalid timestamps, impossible volumes, and unsafe optional values", () => {
  assert.equal(validateReading(tank, baseReading()).valid, true);
  assert.match(validateReading(tank, baseReading({ ts: "2026-01-01T12:00:00" })).reason, /timezone/i);
  assert.match(validateReading(tank, baseReading({ ts: "2025-02-30T12:00:00Z" })).reason, /calendar date/i);
  assert.match(validateReading(tank, baseReading({ volumeLiters: -1 })).reason, /negative/i);
  assert.match(validateReading(tank, baseReading({ volumeLiters: 10_501 })).reason, /capacity/i);
  assert.match(validateReading(tank, baseReading({ batteryPct: 101 })).reason, /battery/i);
});

test("movement classification distinguishes refill, ordinary outflow, anomaly, and noise", () => {
  const refill = classifyMovement({
    previous: previousReading(4_000),
    next: baseReading({ ts: "2026-01-01T13:00:00.000Z", volumeLiters: 4_500 }),
    config: movementConfig,
    withinOperatingHours: true,
  });
  assert.equal(refill.kind, "refill");
  assert.equal(refill.status, "confirmed");

  const outflow = classifyMovement({
    previous: previousReading(4_000),
    next: baseReading({ ts: "2026-01-01T13:00:00.000Z", volumeLiters: 3_800 }),
    config: movementConfig,
    withinOperatingHours: true,
  });
  assert.equal(outflow.kind, "consumption");
  assert.equal(outflow.status, "confirmed");

  const anomaly = classifyMovement({
    previous: previousReading(4_000),
    next: baseReading({ ts: "2026-01-01T12:01:00.000Z", volumeLiters: 3_700 }),
    config: movementConfig,
    withinOperatingHours: false,
  });
  assert.equal(anomaly.kind, "anomaly");
  assert.equal(anomaly.status, "suspected");

  const noise = classifyMovement({
    previous: previousReading(4_000),
    next: baseReading({ ts: "2026-01-01T13:00:00.000Z", volumeLiters: 4_002 }),
    config: movementConfig,
    withinOperatingHours: true,
  });
  assert.equal(noise.kind, "none");
});

test("tank status respects saved thresholds and keeps their ordering valid", () => {
  assert.equal(tankStateForPercent(9.9, 10, 20, 95), "critical");
  assert.equal(tankStateForPercent(10, 10, 20, 95), "low");
  assert.equal(tankStateForPercent(20, 10, 20, 95), "normal");
  assert.equal(tankStateForPercent(95, 10, 20, 95), "full");
  assert.equal(validateTankThresholds({ criticalThresholdPct: 10, lowThresholdPct: 20, overfillThresholdPct: 95 }).ok, true);
  assert.equal(validateTankThresholds({ criticalThresholdPct: 20, lowThresholdPct: 20, overfillThresholdPct: 95 }).ok, false);
  assert.equal(validateTankThresholds({ criticalThresholdPct: 10, lowThresholdPct: 95, overfillThresholdPct: 95 }).ok, false);
});

test("GPS provider scaffolds never coerce telemetry into a fuel reading", () => {
  for (const key of ["queclink", "teltonika"]) {
    const provider = getProvider(key);
    assert.equal(provider.kind, "gps");
    assert.equal(provider.normalize({
      timestamp: "2026-01-01T12:00:00.000Z",
      latitude: -6.8,
      longitude: 39.2,
      speed: 30,
      ignition: true,
      odometer: 12_000,
    }), null);
  }
});

test("operating-hour checks use the station IANA time zone rather than the process zone", () => {
  const station = {
    openingTime: "06:00",
    closingTime: "23:00",
    timezone: "Africa/Dar_es_Salaam",
  };
  assert.equal(isWithinOperatingHours(station, new Date("2026-01-01T18:00:00.000Z")), true);
  assert.equal(isWithinOperatingHours(station, new Date("2026-01-01T21:00:00.000Z")), false);
  assert.equal(normalizeTimeZone("invalid/zone"), "Africa/Dar_es_Salaam");
});

test("local business-day boundaries and report date inputs round-trip in the requested zone", () => {
  const start = dayStartInTimeZone(new Date("2026-01-01T12:00:00.000Z"), 0, "Africa/Dar_es_Salaam");
  assert.equal(start.toISOString(), "2025-12-31T21:00:00.000Z");
  assert.equal(localBucketKeyInTimeZone("2025-12-31T21:30:00.000Z", "day", "Africa/Dar_es_Salaam"), "2026-01-01");

  const input = "2026-01-01T09:45";
  const instant = dateFromDateTimeInputInTimeZone(input, "Africa/Dar_es_Salaam");
  assert.ok(instant);
  assert.equal(instant.toISOString(), "2026-01-01T06:45:00.000Z");
  assert.equal(dateTimeInputValueInTimeZone(instant, "Africa/Dar_es_Salaam"), input);
  assert.equal(dateFromDateTimeInputInTimeZone("2025-03-30T02:30", "Europe/Berlin"), null);
});

test("analytics date ranges start at station-local midnight for business-day periods", () => {
  const timeZone = "Africa/Dar_es_Salaam";
  for (const period of ["today", "7d", "30d", "90d"]) {
    const range = rangeFor(period, undefined, undefined, timeZone);
    const start = datePartsInTimeZone(new Date(range.from), timeZone);
    assert.deepEqual(
      { hour: start.hour, minute: start.minute, second: start.second },
      { hour: 0, minute: 0, second: 0 },
    );
  }
});

test("telemetry freshness distinguishes live, delayed, stale, and unknown", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const options = { liveWithinSeconds: 60, staleAfterSeconds: 600, now };
  assert.equal(telemetryFreshness(null, options), "unknown");
  assert.equal(telemetryFreshness("2026-01-01T11:59:30.000Z", options), "live");
  assert.equal(telemetryFreshness("2026-01-01T11:58:00.000Z", options), "delayed");
  assert.equal(telemetryFreshness("2026-01-01T11:49:00.000Z", options), "stale");
});

test("device recovery uses a fresh timestamp and resolves the matching offline alert type", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  assert.equal(isDeviceFreshForRecovery("2026-01-01T11:55:00.000Z", 10, now), true);
  assert.equal(isDeviceFreshForRecovery("2026-01-01T11:49:59.000Z", 10, now), false);
  assert.equal(isDeviceFreshForRecovery("2026-01-01T12:01:00.000Z", 10, now), false);
  assert.equal(isDeviceFreshForRecovery(null, 10, now), false);
  assert.equal(recoveryAlertTypeForDevice("fuel_probe"), "probe_offline");
  assert.equal(recoveryAlertTypeForDevice("gps_tracker"), "gps_offline");
});

test("operational settings validate the supported contract and retain legacy fallbacks", () => {
  assert.deepEqual(resolveOperatorSettings({
    engine: { deviceOfflineMinutes: 12, reconciliationVariancePct: 1.25 },
  }), {
    retentionDays: 365,
    readingIntervalSec: 60,
    offlineTimeoutMin: 12,
    reconciliationVariancePct: 1.25,
  });
  assert.deepEqual(validateOperationalSettingsPatch({ readingIntervalSec: 90 }), {
    ok: true,
    value: { readingIntervalSec: 90 },
  });
  assert.equal(validateOperationalSettingsPatch({ offlineTimeoutMin: 0 }).ok, false);
  assert.equal(validateOperationalSettingsPatch({ retentionDays: 30 }).ok, false);
});

test("scheduled report validation bounds cadence, local time, station, and recipients", () => {
  const valid = {
    name: "Weekly fuel report",
    category: "consumption",
    period: "weekly",
    dayOfWeek: 1,
    dayOfMonth: null,
    timeOfDay: "07:30",
    format: "csv",
    stationId: "station-a",
    recipients: [" Ops@Example.com ", "ops@example.com"],
    isEnabled: true,
  };
  const result = validateScheduleDefinition(valid);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recipients, ["ops@example.com"]);
  assert.equal(validateScheduleDefinition({ ...valid, dayOfWeek: 7 }).ok, false);
  assert.equal(validateScheduleDefinition({ ...valid, timeOfDay: "24:00" }).ok, false);
  assert.equal(validateScheduleDefinition({ ...valid, recipients: ["not-an-email"] }).ok, false);
  assert.equal(validateScheduleDefinition({ ...valid, period: "monthly", dayOfWeek: null, dayOfMonth: 32 }).ok, false);
});
