import { query, queryOne } from "../db/client";
import {
  listAllStations,
  listAllTanks,
  listFuelTypes,
  getStation,
  getTank,
  getFuelType,
} from "../db/repo/stations";
import { listAllDevices, listAllVehicles } from "../db/repo/devices";
import { getOrganization, getSettings } from "../db/repo/core";
import { resolveOperatorSettings } from "../domain/system-config";
import { telemetryFreshness } from "../domain/device-freshness";
import { dayStartInTimeZone, localBucketKeyInTimeZone, normalizeTimeZone } from "./time-zone";
import {
  listAlerts,
  listAlertRules,
  listEnabledRules,
} from "../db/repo/alerts";
import {
  levelSeries,
  listEvents,
  movementSeries,
  movementTotals,
} from "../db/repo/events";
import { latestReadingForTank } from "../db/repo/readings";
import { reconcileTank, stockCoverage } from "../engine/fuel";
import type { Alert, Device, Station, Tank } from "../domain/types";

/**
 * Read-model / analytics layer.
 *
 * Every number the dashboard shows is computed here from the same tables the
 * rest of the platform reads, so KPIs, charts and tables can never disagree.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function dayStart(offsetDays = 0, timeZone = "Africa/Dar_es_Salaam", at = new Date()): string {
  return dayStartInTimeZone(at, offsetDays, timeZone).toISOString();
}

/** Device statuses that mean "this device is not reporting" (see DeviceFilter.reporting). */
const NOT_REPORTING = new Set(["offline", "fault", "never_connected"]);

export interface DateRange {
  from: string;
  to: string;
}

export function rangeFor(
  period: "today" | "7d" | "30d" | "90d" | "custom",
  from?: string,
  to?: string,
  timeZone = "Africa/Dar_es_Salaam",
): DateRange {
  const zone = normalizeTimeZone(timeZone);
  const now = new Date().toISOString();
  switch (period) {
    case "today":
      return { from: dayStart(0, zone), to: now };
    case "7d":
      return { from: dayStart(-6, zone), to: now };
    case "30d":
      return { from: dayStart(-29, zone), to: now };
    case "90d":
      return { from: dayStart(-89, zone), to: now };
    case "custom":
      return { from: from ?? dayStart(-7, zone), to: to ?? now };
    default:
      return { from: dayStart(0, zone), to: now };
  }
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export interface StationSummary {
  station: Station;
  tankCount: number;
  totalFuel: number;
  capacity: number;
  utilizationPct: number;
  avgLevelPct: number;
  lowTanks: number;
  criticalTanks: number;
  activeAlerts: number;
  onlineDevices: number;
  offlineDevices: number;
  todayConsumption: number;
  todayRefills: number;
  status: Station["status"];
}

export interface DashboardData {
  generatedAt: string;
  timeZone: string;
  telemetry: {
    latestValidAt: string | null;
    liveWithinSeconds: number;
    staleAfterSeconds: number;
  };
  range: DateRange;
  period: string;
  kpis: {
    totalStations: number;
    onlineStations: number;
    offlineStations: number;
    totalTanks: number;
    totalFuel: number;
    totalCapacity: number;
    averageLevelPct: number;
    lowFuelTanks: number;
    criticalFuelTanks: number;
    activeAlerts: number;
    criticalAlerts: number;
    warningAlerts: number;
    todayConsumption: number;
    todayRefills: number;
    refillCount: number;
    suspectedLoss: number;
    connectedDevices: number;
    offlineDevices: number;
    totalDevices: number;
    vehicles: number;
  };
  stations: StationSummary[];
  charts: {
    levelTrend: { bucket: string; avgVolume: number; avgPercent: number }[];
    consumptionTrend: { bucket: string; consumption: number; refills: number }[];
    receivedVsDispensed: { label: string; received: number; dispensed: number }[];
    stationComparison: { name: string; fuel: number; capacity: number; consumption: number }[];
    tankLevels: { name: string; percent: number; volume: number; capacity: number; fuelType: string; color: string }[];
    fuelLoss: { bucket: string; loss: number }[];
    alertFrequency: { bucket: string; critical: number; warning: number; info: number }[];
  };
  alerts: Alert[];
  recentMovements: MovementRow[];
  deviceHealth: Device[];
  lowTanks: Tank[];
  orgName: string;
  currency: string;
}

export interface MovementRow {
  id: string;
  ts: string;
  type: string;
  volume: number;
  levelBefore: number;
  levelAfter: number;
  confidence: string;
  status: string;
  reason: string | null;
  tankId: string;
  tankName: string;
  stationId: string;
  stationName: string;
  deviceId: string | null;
  deviceSerial: string | null;
  fuelType: string;
  fuelColor: string;
}

export async function buildDashboard(
  orgId: string,
  period: "today" | "7d" | "30d" | "90d" = "7d",
  stationIds?: string[],
  timeZoneOverride?: string,
): Promise<DashboardData> {
  const [organization, storedSettings, allStations, allTanks, fuelTypes, allDevices, allVehicles] = await Promise.all([
    getOrganization(orgId),
    getSettings(orgId),
    listAllStations(orgId),
    listAllTanks(orgId),
    listFuelTypes(orgId),
    listAllDevices(orgId),
    listAllVehicles(orgId),
  ]);
  const timeZone = normalizeTimeZone(timeZoneOverride ?? organization?.timezone);
  const range = rangeFor(period, undefined, undefined, timeZone);
  const today = rangeFor("today", undefined, undefined, timeZone);
  const operatorSettings = resolveOperatorSettings(storedSettings);
  const scopedStationIds = stationIds;
  const stations = scopedStationIds !== undefined ? allStations.filter((station) => scopedStationIds.includes(station.id)) : allStations;
  const tanks = scopedStationIds !== undefined ? allTanks.filter((tank) => scopedStationIds.includes(tank.stationId)) : allTanks;
  const tankIds = new Set(tanks.map((tank) => tank.id));
  const vehicleIds = new Set(
    scopedStationIds === undefined
      ? allVehicles.map((vehicle) => vehicle.id)
      : allVehicles.filter((vehicle) => vehicle.stationId && scopedStationIds.includes(vehicle.stationId)).map((vehicle) => vehicle.id),
  );
  const devices = scopedStationIds !== undefined
    ? allDevices.filter((device) => {
        const hasAllowedStation =
          Boolean(device.stationId && scopedStationIds.includes(device.stationId)) ||
          Boolean(device.tankId && tankIds.has(device.tankId)) ||
          Boolean(device.vehicleId && vehicleIds.has(device.vehicleId));
        const assignmentsAllowed =
          (!device.stationId || scopedStationIds.includes(device.stationId)) &&
          (!device.tankId || tankIds.has(device.tankId)) &&
          (!device.vehicleId || vehicleIds.has(device.vehicleId));
        return hasAllowedStation && assignmentsAllowed;
      })
    : allDevices;
  const vehicles = scopedStationIds !== undefined ? allVehicles.filter((vehicle) => vehicle.stationId && scopedStationIds.includes(vehicle.stationId)) : allVehicles;

  const fuelTypeById = new Map(fuelTypes.map((f) => [f.id, f]));
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const stationScopeSql = scopedStationIds === undefined
    ? ""
    : scopedStationIds.length === 0
      ? " AND 1 = 0"
      : ` AND station_id IN (${scopedStationIds.map(() => "?").join(", ")})`;
  const stationScopeParams = scopedStationIds?.length ? scopedStationIds : [];

  const activeAlerts = (await listAlerts({ orgId, status: "active", pageSize: 200, stationIds: scopedStationIds }));
  const todayTotals = (await movementTotals(orgId, today.from, today.to, undefined, undefined, scopedStationIds));
  const rangeTotals = (await movementTotals(orgId, range.from, range.to, undefined, undefined, scopedStationIds));

  const probes = devices.filter((d) => d.type === "fuel_probe");
  // The two buckets are complementary and use exactly the predicate behind
  // `GET /api/devices?reporting=problem`, so the KPI card, its deep link and the
  // devices table can never disagree.
  const onlineDevices = probes.filter((d) => !NOT_REPORTING.has(d.status)).length;
  const offlineDevices = probes.filter((d) => NOT_REPORTING.has(d.status)).length;

  const [activeAlertGroups, stationMovementGroups] = await Promise.all([
    query<{ station_id: string; severity: string; n: number }>(
      `SELECT station_id, severity, count(*) AS n FROM alerts
       WHERE organization_id = ? AND status = 'active'${stationScopeSql}
       GROUP BY station_id, severity`,
      [orgId, ...stationScopeParams],
    ),
    query<{ station_id: string; consumption: number; refills: number }>(
      `SELECT station_id,
              COALESCE(SUM(CASE WHEN type = 'consumption' THEN volume ELSE 0 END), 0) AS consumption,
              COALESCE(SUM(CASE WHEN type = 'refill' THEN volume ELSE 0 END), 0) AS refills
       FROM fuel_events WHERE organization_id = ? AND ts >= ? AND ts <= ?${stationScopeSql}
       GROUP BY station_id`,
      [orgId, today.from, today.to, ...stationScopeParams],
    ),
  ]);
  const alertsByStation = new Map<string, number>();
  let criticalAlertCount = 0;
  let warningAlertCount = 0;
  for (const group of activeAlertGroups) {
    const count = Number(group.n ?? 0);
    alertsByStation.set(group.station_id, (alertsByStation.get(group.station_id) ?? 0) + count);
    if (group.severity === "critical") criticalAlertCount += count;
    if (group.severity === "warning") warningAlertCount += count;
  }
  const movementsByStation = new Map(stationMovementGroups.map((group) => [group.station_id, {
    consumption: Number(group.consumption ?? 0),
    refills: Number(group.refills ?? 0),
  }]));
  const tanksByStation = new Map<string, Tank[]>();
  for (const tank of tanks) {
    const group = tanksByStation.get(tank.stationId) ?? [];
    group.push(tank);
    tanksByStation.set(tank.stationId, group);
  }
  const probesByStation = new Map<string, Device[]>();
  for (const device of probes) {
    if (!device.stationId) continue;
    const group = probesByStation.get(device.stationId) ?? [];
    group.push(device);
    probesByStation.set(device.stationId, group);
  }

  /* ---- station summaries ---- */
  const stationsSummary: StationSummary[] = stations.map((station) => {
    const stationTanks = tanksByStation.get(station.id) ?? [];
    const totalFuel = stationTanks.reduce((sum, tank) => sum + tank.currentVolume, 0);
    const capacity = stationTanks.reduce((sum, tank) => sum + tank.capacity, 0);
    const utilizationPct = capacity > 0 ? (totalFuel / capacity) * 100 : 0;
    const avgLevelPct = stationTanks.length > 0
      ? stationTanks.reduce((sum, tank) => sum + (tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0), 0) / stationTanks.length
      : 0;
    const stationDevices = probesByStation.get(station.id) ?? [];
    const stationMovements = movementsByStation.get(station.id) ?? { consumption: 0, refills: 0 };
    const hasDevices = stationDevices.length > 0;
    const worst =
      stationTanks.some((tank) => tank.status === "offline") ||
      (hasDevices && stationDevices.every((device) => device.status !== "online"))
        ? "offline"
        : stationTanks.some((tank) => tank.status === "critical")
          ? "critical"
          : stationTanks.some((tank) => tank.status === "low")
            ? "warning"
            : "online";
    return {
      station,
      tankCount: stationTanks.length,
      totalFuel,
      capacity,
      utilizationPct,
      avgLevelPct,
      lowTanks: stationTanks.filter((tank) => tank.status === "low").length,
      criticalTanks: stationTanks.filter((tank) => tank.status === "critical").length,
      activeAlerts: alertsByStation.get(station.id) ?? 0,
      onlineDevices: stationDevices.filter((device) => !NOT_REPORTING.has(device.status)).length,
      offlineDevices: stationDevices.filter((device) => NOT_REPORTING.has(device.status)).length,
      todayConsumption: stationMovements.consumption,
      todayRefills: stationMovements.refills,
      status: worst,
    };
  });

  /* ---- charts ---- */
  const granularity: "hour" | "day" = period === "today" ? "hour" : "day";
  const levelTrend = (await levelSeries(orgId, range.from, range.to, granularity, undefined, undefined, scopedStationIds, timeZone));
  const movements = (await movementSeries(orgId, range.from, range.to, granularity, undefined, undefined, scopedStationIds, timeZone));
  const consumptionTrend = movements.map((m) => ({
    bucket: m.bucket,
    consumption: m.consumption,
    refills: m.refills,
  }));

  const receivedVsDispensed = [
    {
      label: period === "today" ? "Today" : `Last ${period === "7d" ? 7 : period === "30d" ? 30 : 90} days`,
      received: rangeTotals.refills,
      dispensed: rangeTotals.consumption,
    },
  ];

  const stationComparison = stationsSummary
    .map((s) => ({
      name: s.station.name.replace(/^PUMA\s*/, "").replace(/\s*—.*$/, ""),
      fuel: Math.round(s.totalFuel),
      capacity: Math.round(s.capacity),
      consumption: Math.round(s.todayConsumption),
    }))
    .sort((a, b) => b.fuel - a.fuel);

  const tankLevels = tanks
    .map((t) => {
      const ft = fuelTypeById.get(t.fuelTypeId);
      return {
        name: `${t.name.replace(/\s+Tank\s*/, " ")}`,
        percent: t.capacity > 0 ? Number(((t.currentVolume / t.capacity) * 100).toFixed(1)) : 0,
        volume: Math.round(t.currentVolume),
        capacity: Math.round(t.capacity),
        fuelType: ft?.systemName ?? "unknown",
        color: ft?.color ?? "#64748b",
        stationId: t.stationId,
        tankId: t.id,
      };
    })
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 12);

  const rawLossSeries = await query<{ bucket: string; loss: number }>(
    `SELECT strftime('%Y-%m-%dT%H:00', ts) AS bucket,
            COALESCE(SUM(CASE WHEN type = 'anomaly' THEN volume ELSE 0 END), 0) AS loss
     FROM fuel_events WHERE organization_id = ? AND ts >= ? AND ts <= ?${stationScopeSql}
     GROUP BY bucket ORDER BY bucket ASC`,
    [orgId, range.from, range.to, ...stationScopeParams],
  );
  const lossByBucket = new Map<string, number>();
  for (const row of rawLossSeries) {
    const bucket = localBucketKeyInTimeZone(new Date(`${row.bucket}:00Z`), granularity, timeZone);
    lossByBucket.set(bucket, (lossByBucket.get(bucket) ?? 0) + Number(row.loss ?? 0));
  }
  const lossSeries = [...lossByBucket.entries()]
    .map(([bucket, loss]) => ({ bucket, loss }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket));

  const rawAlertFrequency = await query<{ bucket: string; severity: string; n: number }>(
    `SELECT strftime('%Y-%m-%dT%H:00', created_at) AS bucket, severity, count(*) AS n
     FROM alerts WHERE organization_id = ? AND created_at >= ? AND created_at <= ?${stationScopeSql}
     GROUP BY bucket, severity ORDER BY bucket ASC`,
    [orgId, range.from, range.to, ...stationScopeParams],
  );
  const alertsByBucket = new Map<string, { critical: number; warning: number; info: number }>();
  for (const row of rawAlertFrequency) {
    const bucket = localBucketKeyInTimeZone(new Date(`${row.bucket}:00Z`), granularity, timeZone);
    const counts = alertsByBucket.get(bucket) ?? { critical: 0, warning: 0, info: 0 };
    if (row.severity === "critical") counts.critical += Number(row.n ?? 0);
    if (row.severity === "warning") counts.warning += Number(row.n ?? 0);
    if (row.severity === "info") counts.info += Number(row.n ?? 0);
    alertsByBucket.set(bucket, counts);
  }
  const alertFrequency = [...alertsByBucket.entries()]
    .map(([bucket, counts]) => ({ bucket, ...counts }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket));

  /* ---- recent movements ---- */
  const movementsPage = (await listEvents({
    orgId,
    from: range.from,
    to: range.to,
    page: 1,
    pageSize: 12,
    stationIds: scopedStationIds,
  }));
  const deviceById = new Map(devices.map((d) => [d.id, d]));
  const tankById = new Map(tanks.map((t) => [t.id, t]));
  const recentMovements: MovementRow[] = movementsPage.rows.map((ev) => {
    const tank = tankById.get(ev.tankId);
    const station = stationById.get(ev.stationId);
    const device = ev.deviceId ? deviceById.get(ev.deviceId) : null;
    const ft = tank ? fuelTypeById.get(tank.fuelTypeId) : null;
    return {
      id: ev.id,
      ts: ev.ts,
      type: ev.type,
      volume: ev.volume,
      levelBefore: ev.levelBefore,
      levelAfter: ev.levelAfter,
      confidence: ev.confidence,
      status: ev.status,
      reason: ev.reason,
      tankId: ev.tankId,
      tankName: tank?.name ?? "Unknown tank",
      stationId: ev.stationId,
      stationName: station?.name ?? "Unknown station",
      deviceId: ev.deviceId,
      deviceSerial: device?.serialNumber ?? null,
      fuelType: ft?.systemName ?? "unknown",
      fuelColor: ft?.color ?? "#64748b",
    };
  });

  const totalFuel = tanks.reduce((sum, t) => sum + t.currentVolume, 0);
  const totalCapacity = tanks.reduce((sum, t) => sum + t.capacity, 0);
  const latestValidAt = probes.reduce<string | null>((latest, device) => {
    if (!device.lastSeenAt) return latest;
    if (!latest || Date.parse(device.lastSeenAt) > Date.parse(latest)) return device.lastSeenAt;
    return latest;
  }, null);
  const recentProbes = [...probes]
    .sort((left, right) => Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? ""))
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    timeZone,
    telemetry: {
      latestValidAt,
      liveWithinSeconds: Math.ceil(operatorSettings.readingIntervalSec * 1.5),
      staleAfterSeconds: operatorSettings.offlineTimeoutMin * 60,
    },
    range,
    period,
    kpis: {
      totalStations: stations.length,
      // "Online" means the site is trading; a station can be online and still be
      // in a warning or critical state, so only a true outage counts as offline.
      onlineStations: stations.filter((s) => s.status !== "offline" && !s.isArchived).length,
      offlineStations: stations.filter((s) => s.status === "offline" || s.isArchived).length,
      totalTanks: tanks.length,
      totalFuel: Math.round(totalFuel),
      totalCapacity: Math.round(totalCapacity),
      averageLevelPct: totalCapacity > 0 ? (totalFuel / totalCapacity) * 100 : 0,
      lowFuelTanks: tanks.filter((t) => t.status === "low").length,
      criticalFuelTanks: tanks.filter((t) => t.status === "critical").length,
      activeAlerts: activeAlerts.total,
      criticalAlerts: criticalAlertCount,
      warningAlerts: warningAlertCount,
      todayConsumption: Math.round(todayTotals.consumption),
      todayRefills: Math.round(todayTotals.refills),
      refillCount: todayTotals.refillCount,
      // `rangeTotals` already covers today, so adding `todayTotals` again would
      // double-count the day's anomalies and overstate the figure.
      suspectedLoss: Math.round(rangeTotals.suspectedLoss),
      connectedDevices: onlineDevices,
      offlineDevices,
      totalDevices: probes.length,
      vehicles: vehicles.length,
    },
    stations: stationsSummary,
    charts: {
      levelTrend,
      consumptionTrend,
      receivedVsDispensed,
      stationComparison,
      tankLevels,
      fuelLoss: lossSeries,
      alertFrequency,
    },
    alerts: activeAlerts.rows.slice(0, 6),
    recentMovements,
    deviceHealth: recentProbes,
    lowTanks: tanks
      .filter((t) => t.status === "low" || t.status === "critical" || t.status === "offline")
      .sort((a, b) => a.currentVolume / (a.capacity || 1) - b.currentVolume / (b.capacity || 1)),
    orgName: organization?.name ?? "",
    currency: organization?.currency ?? "TZS",
  };
}

/* -------------------------------------------------------------------------- */
/* Tank detail read model                                                     */
/* -------------------------------------------------------------------------- */

export interface TankDetail {
  tank: Tank;
  station: Station | null;
  fuelType: Awaited<ReturnType<typeof getFuelType>>;
  device: Device | null;
  latestReading: Awaited<ReturnType<typeof latestReadingForTank>>;
  fillPercent: number;
  remainingCapacity: number;
  status: Tank["status"];
  dataState: "live" | "delayed" | "stale" | "unknown";
  lastUpdateAgeMinutes: number;
  todayConsumption: number;
  todayRefills: number;
  coverage: { avgDailyConsumption: number; daysRemaining: number | null };
  reconciliation: Awaited<ReturnType<typeof reconcileTank>>;
  events: MovementRow[];
  alerts: Alert[];
  history: { bucket: string; avgVolume: number; avgPercent: number; avgTemp: number; avgWater: number }[];
  readings: { id: string; ts: string; volumeLiters: number; levelPercent: number | null; temperatureC: number | null; waterLevelMm: number | null; signal: number | null; batteryPct: number | null; deviceSerial: string | null }[];
}

export async function buildTankDetail(tankId: string, period: "24h" | "7d" | "30d" | "90d" = "7d"): Promise<TankDetail | null> {
  const tank = (await getTank(tankId));
  if (!tank) return null;
  const [station, organization, storedSettings, fuelType, devices, latestReading] = await Promise.all([
    getStation(tank.stationId),
    getOrganization(tank.organizationId),
    getSettings(tank.organizationId),
    getFuelType(tank.fuelTypeId),
    listAllDevices(tank.organizationId),
    latestReadingForTank(tank.id),
  ]);
  const timeZone = normalizeTimeZone(station?.timezone ?? organization?.timezone);
  const operatorSettings = resolveOperatorSettings(storedSettings);
  const device = devices.find((entry) => entry.tankId === tank.id && entry.type === "fuel_probe") ?? null;

  const fillPercent = tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0;
  const remainingCapacity = Math.max(0, tank.capacity - tank.currentVolume);

  const lastValidAt = device?.lastSeenAt ?? tank.lastValidReadingAt ?? null;
  const lastUpdate = lastValidAt ? new Date(lastValidAt) : null;
  const lastUpdateAgeMinutes = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 60000 : Infinity;
  const dataState = telemetryFreshness(lastValidAt, {
    liveWithinSeconds: Math.ceil(operatorSettings.readingIntervalSec * 1.5),
    staleAfterSeconds: operatorSettings.offlineTimeoutMin * 60,
  });

  const today = rangeFor("today", undefined, undefined, timeZone);
  const range = period === "24h"
    ? { from: new Date(Date.now() - DAY).toISOString(), to: new Date().toISOString() }
    : rangeFor(period.toLowerCase() as "7d" | "30d" | "90d", undefined, undefined, timeZone);
  const granularity: "hour" | "day" = period === "24h" ? "hour" : "day";

  const [todayTotals, historyHours, eventsPage, alertsResult, rawRecentReadings, coverage, reconciliation] = await Promise.all([
    movementTotals(tank.organizationId, today.from, today.to, undefined, tank.id),
    query<{
      bucket: string;
      volumeTotal: number;
      volumeCount: number;
      percentTotal: number | null;
      percentCount: number;
      tempTotal: number | null;
      tempCount: number;
      waterTotal: number | null;
      waterCount: number;
    }>(
      `SELECT strftime('%Y-%m-%dT%H:00', ts) AS bucket,
              COALESCE(SUM(volume_liters), 0) AS volumeTotal,
              COUNT(*) AS volumeCount,
              SUM(level_percent) AS percentTotal,
              COUNT(level_percent) AS percentCount,
              SUM(temperature_c) AS tempTotal,
              COUNT(temperature_c) AS tempCount,
              SUM(water_level_mm) AS waterTotal,
              COUNT(water_level_mm) AS waterCount
       FROM readings WHERE tank_id = ? AND ts >= ? AND ts <= ?
       GROUP BY bucket ORDER BY bucket ASC`,
      [tank.id, range.from, range.to],
    ),
    listEvents({ orgId: tank.organizationId, tankId: tank.id, page: 1, pageSize: 40 }),
    listAlerts({ orgId: tank.organizationId, tankId: tank.id, pageSize: 50 }),
    query<Record<string, unknown>>(
      `SELECT r.*, d.serial_number AS device_serial FROM readings r JOIN devices d ON d.id = r.device_id
       WHERE r.tank_id = ? ORDER BY r.ts DESC LIMIT 40`,
      [tank.id],
    ),
    stockCoverage(tank.id, 7, timeZone),
    reconcileTank(tank.id, range.from, range.to, operatorSettings.reconciliationVariancePct),
  ]);
  const historyGroups = new Map<string, {
    volumeTotal: number;
    volumeCount: number;
    percentTotal: number;
    percentCount: number;
    tempTotal: number;
    tempCount: number;
    waterTotal: number;
    waterCount: number;
  }>();
  for (const row of historyHours) {
    const bucket = localBucketKeyInTimeZone(new Date(`${row.bucket}:00Z`), granularity, timeZone);
    const totals = historyGroups.get(bucket) ?? {
      volumeTotal: 0, volumeCount: 0, percentTotal: 0, percentCount: 0,
      tempTotal: 0, tempCount: 0, waterTotal: 0, waterCount: 0,
    };
    totals.volumeTotal += Number(row.volumeTotal ?? 0);
    totals.volumeCount += Number(row.volumeCount ?? 0);
    totals.percentTotal += Number(row.percentTotal ?? 0);
    totals.percentCount += Number(row.percentCount ?? 0);
    totals.tempTotal += Number(row.tempTotal ?? 0);
    totals.tempCount += Number(row.tempCount ?? 0);
    totals.waterTotal += Number(row.waterTotal ?? 0);
    totals.waterCount += Number(row.waterCount ?? 0);
    historyGroups.set(bucket, totals);
  }
  const history = [...historyGroups.entries()]
    .map(([bucket, totals]) => ({
      bucket,
      avgVolume: totals.volumeCount ? totals.volumeTotal / totals.volumeCount : 0,
      avgPercent: totals.percentCount ? totals.percentTotal / totals.percentCount : 0,
      avgTemp: totals.tempCount ? totals.tempTotal / totals.tempCount : 0,
      avgWater: totals.waterCount ? totals.waterTotal / totals.waterCount : 0,
    }))
    .sort((left, right) => left.bucket.localeCompare(right.bucket));

  const events: MovementRow[] = eventsPage.rows.map((ev) => ({
    id: ev.id,
    ts: ev.ts,
    type: ev.type,
    volume: ev.volume,
    levelBefore: ev.levelBefore,
    levelAfter: ev.levelAfter,
    confidence: ev.confidence,
    status: ev.status,
    reason: ev.reason,
    tankId: tank.id,
    tankName: tank.name,
    stationId: tank.stationId,
    stationName: station?.name ?? "",
    deviceId: ev.deviceId,
    deviceSerial: device?.serialNumber ?? null,
    fuelType: fuelType?.systemName ?? "unknown",
    fuelColor: fuelType?.color ?? "#64748b",
  }));

  const alerts = alertsResult.rows;

  const recentReadings = rawRecentReadings.map((row) => ({
    id: String(row.id),
    ts: String(row.ts),
    volumeLiters: Number(row.volume_liters),
    levelPercent: row.level_percent == null ? null : Number(row.level_percent),
    temperatureC: row.temperature_c == null ? null : Number(row.temperature_c),
    waterLevelMm: row.water_level_mm == null ? null : Number(row.water_level_mm),
    signal: row.signal == null ? null : Number(row.signal),
    batteryPct: row.battery_pct == null ? null : Number(row.battery_pct),
    deviceSerial: row.device_serial == null ? null : String(row.device_serial),
  }));

  return {
    tank,
    station,
    fuelType,
    device,
    latestReading,
    fillPercent,
    remainingCapacity,
    status: tank.status,
    dataState,
    lastUpdateAgeMinutes: Number.isFinite(lastUpdateAgeMinutes) ? lastUpdateAgeMinutes : 9999,
    todayConsumption: Math.round(todayTotals.consumption),
    todayRefills: Math.round(todayTotals.refills),
    coverage,
    reconciliation,
    events,
    alerts,
    history,
    readings: recentReadings,
  };
}

/* -------------------------------------------------------------------------- */
/* Station detail read model                                                   */
/* -------------------------------------------------------------------------- */

export async function buildStationDetail(stationId: string, period: "today" | "7d" | "30d" = "7d") {
  const station = (await getStation(stationId));
  if (!station) return null;
  const timeZone = normalizeTimeZone(station.timezone);
  const range = rangeFor(period, undefined, undefined, timeZone);
  const today = rangeFor("today", undefined, undefined, timeZone);
  const [allTanks, fuelTypes, allDevices] = await Promise.all([
    listAllTanks(station.organizationId, station.isArchived),
    listFuelTypes(station.organizationId),
    listAllDevices(station.organizationId),
  ]);
  const tanks = allTanks.filter((tank) => tank.stationId === station.id);
  const devices = allDevices.filter((device) => device.stationId === station.id);
  const [totals, todayTotals, alerts, movements] = await Promise.all([
    movementTotals(station.organizationId, range.from, range.to, station.id),
    movementTotals(station.organizationId, today.from, today.to, station.id),
    listAlerts({ orgId: station.organizationId, stationId: station.id, pageSize: 100 }),
    listEvents({ orgId: station.organizationId, stationId: station.id, page: 1, pageSize: 12 }),
  ]);
  const totalFuel = tanks.reduce((sum, tank) => sum + tank.currentVolume, 0);
  const capacity = tanks.reduce((sum, tank) => sum + tank.capacity, 0);

  return {
    station,
    tanks,
    fuelTypes,
    devices,
    range,
    alerts: alerts.rows,
    totalFuel,
    capacity,
    utilizationPct: capacity > 0 ? (totalFuel / capacity) * 100 : 0,
    todayConsumption: Math.round(todayTotals.consumption),
    todayRefills: Math.round(todayTotals.refills),
    rangeConsumption: Math.round(totals.consumption),
    rangeRefills: Math.round(totals.refills),
    rangeSuspectedLoss: Math.round(totals.suspectedLoss),
    movements: movements.rows,
    levelTrend: (await levelSeries(
      station.organizationId,
      range.from,
      range.to,
      period === "today" ? "hour" : "day",
      station.id,
      undefined,
      undefined,
      timeZone,
    )),
    movementTrend: (await movementSeries(
      station.organizationId,
      range.from,
      range.to,
      period === "today" ? "hour" : "day",
      station.id,
      undefined,
      undefined,
      timeZone,
    )),
  };
}

/* -------------------------------------------------------------------------- */
/* Global search                                                              */
/* -------------------------------------------------------------------------- */

export interface SearchHit {
  id: string;
  kind: "station" | "tank" | "device" | "vehicle" | "alert" | "user" | "report";
  title: string;
  subtitle: string;
  meta: string;
  href: string;
  score: number;
}

export async function globalSearch(
  orgId: string,
  term: string,
  limit = 12,
  stationIds?: string[],
  allowedKinds: SearchHit["kind"][] = ["station", "tank", "device", "vehicle", "alert", "user", "report"],
): Promise<SearchHit[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 1) return [];
  const like = `%${q}%`;
  const allowed = new Set(allowedKinds);
  const scopedStationIds = stationIds;
  const stationPlaceholders = scopedStationIds?.map(() => "?").join(", ") ?? "";
  const stationClause = (column: string) => {
    if (scopedStationIds === undefined) return { sql: "", params: [] as unknown[] };
    if (scopedStationIds.length === 0) return { sql: " AND 1 = 0", params: [] as unknown[] };
    return { sql: ` AND ${column} IN (${stationPlaceholders})`, params: [...scopedStationIds] as unknown[] };
  };
  const hits: SearchHit[] = [];

  if (allowed.has("station")) {
    const scope = stationClause("s.id");
    const stations = (await query<Record<string, unknown>>(
      `SELECT s.id, s.name, s.code, s.city, s.status FROM stations s
       WHERE s.organization_id = ?${scope.sql} AND (s.name LIKE ? OR s.code LIKE ? OR s.city LIKE ?) LIMIT 6`,
      [orgId, ...scope.params, like, like, like],
    ));
    for (const s of stations) {
      hits.push({ id: String(s.id), kind: "station", title: String(s.name), subtitle: `Station ${String(s.code)} · ${String(s.city)}`, meta: String(s.status), href: `/stations/${s.id}`, score: 3 });
    }
  }

  if (allowed.has("tank")) {
    const scope = stationClause("t.station_id");
    const tanks = (await query<Record<string, unknown>>(
      `SELECT t.id, t.name, t.capacity, t.current_volume, s.name AS station_name, ft.system_name AS fuel
       FROM tanks t JOIN stations s ON s.id = t.station_id JOIN fuel_types ft ON ft.id = t.fuel_type_id
       WHERE t.organization_id = ?${scope.sql} AND t.is_archived = 0 AND (t.name LIKE ? OR t.code LIKE ? OR s.name LIKE ?) LIMIT 6`,
      [orgId, ...scope.params, like, like, like],
    ));
    for (const t of tanks) {
      const pct = Number(t.capacity) > 0 ? (Number(t.current_volume) / Number(t.capacity)) * 100 : 0;
      hits.push({ id: String(t.id), kind: "tank", title: String(t.name), subtitle: `${String(t.station_name)} · ${String(t.fuel)}`, meta: `${Math.round(Number(t.current_volume)).toLocaleString()} L · ${pct.toFixed(0)}%`, href: `/tanks/${t.id}`, score: 3 });
    }
  }

  if (allowed.has("device")) {
    let deviceScope = "";
    let deviceParams: unknown[] = [];
    if (scopedStationIds !== undefined) {
      if (scopedStationIds.length === 0) deviceScope = " AND 1 = 0";
      else {
        deviceScope = ` AND (
          (d.station_id IS NULL OR d.station_id IN (${stationPlaceholders}))
          AND (d.tank_id IS NULL OR d.tank_id IN (SELECT t.id FROM tanks t WHERE t.organization_id = ? AND t.station_id IN (${stationPlaceholders})))
          AND (d.vehicle_id IS NULL OR d.vehicle_id IN (SELECT v.id FROM vehicles v WHERE v.organization_id = ? AND v.station_id IN (${stationPlaceholders})))
          AND (
            d.station_id IN (${stationPlaceholders})
            OR d.tank_id IN (SELECT t.id FROM tanks t WHERE t.organization_id = ? AND t.station_id IN (${stationPlaceholders}))
            OR d.vehicle_id IN (SELECT v.id FROM vehicles v WHERE v.organization_id = ? AND v.station_id IN (${stationPlaceholders}))
          )
        )`;
        deviceParams = [
          ...scopedStationIds,
          orgId, ...scopedStationIds,
          orgId, ...scopedStationIds,
          ...scopedStationIds,
          orgId, ...scopedStationIds,
          orgId, ...scopedStationIds,
        ];
      }
    }
    const devices = (await query<Record<string, unknown>>(
      `SELECT d.id, d.serial_number, d.type, d.status, d.label FROM devices d
       WHERE d.organization_id = ?${deviceScope} AND d.is_active = 1 AND (d.serial_number LIKE ? OR d.label LIKE ?) LIMIT 6`,
      [orgId, ...deviceParams, like, like],
    ));
    for (const d of devices) {
      hits.push({ id: String(d.id), kind: "device", title: String(d.serial_number), subtitle: `${d.type === "fuel_probe" ? "Fuel probe" : "GPS tracker"}${d.label ? ` · ${String(d.label)}` : ""}`, meta: String(d.status).replace("_", " "), href: `/devices`, score: 2 });
    }
  }

  if (allowed.has("vehicle")) {
    const scope = stationClause("v.station_id");
    const vehicles = (await query<Record<string, unknown>>(
      `SELECT v.id, v.name, v.plate_number, v.status FROM vehicles v
       WHERE v.organization_id = ?${scope.sql} AND v.is_archived = 0 AND (v.name LIKE ? OR v.plate_number LIKE ?) LIMIT 4`,
      [orgId, ...scope.params, like, like],
    ));
    for (const v of vehicles) {
      hits.push({ id: String(v.id), kind: "vehicle", title: String(v.name), subtitle: `Vehicle · ${String(v.plate_number)}`, meta: String(v.status), href: `/vehicles`, score: 2 });
    }
  }

  if (allowed.has("alert")) {
    const scope = stationClause("a.station_id");
    const alerts = (await query<Record<string, unknown>>(
      `SELECT a.id, a.title, a.severity, a.status, a.type FROM alerts a
       WHERE a.organization_id = ?${scope.sql} AND (a.title LIKE ? OR a.message LIKE ?) LIMIT 4`,
      [orgId, ...scope.params, like, like],
    ));
    for (const a of alerts) {
      hits.push({ id: String(a.id), kind: "alert", title: String(a.title), subtitle: `Alert · ${String(a.type).replace(/_/g, " ")}`, meta: String(a.status), href: `/alerts?highlight=${a.id}`, score: 2 });
    }
  }

  if (allowed.has("user")) {
    let userScope = "";
    let userParams: unknown[] = [];
    if (scopedStationIds !== undefined) {
      if (scopedStationIds.length === 0) userScope = " AND 1 = 0";
      else {
        userScope = ` AND ur.key NOT IN ('admin', 'super_admin', 'owner')
          AND u.id IN (SELECT us.user_id FROM user_stations us WHERE us.station_id IN (${stationPlaceholders}))
          AND NOT EXISTS (
            SELECT 1 FROM user_stations us_out
            WHERE us_out.user_id = u.id AND us_out.station_id NOT IN (${stationPlaceholders})
          )`;
        userParams = [...scopedStationIds, ...scopedStationIds];
      }
    }
    const users = (await query<Record<string, unknown>>(
      `SELECT u.id, u.name, u.email, u.job_title FROM users u JOIN roles ur ON ur.id = u.role_id
       WHERE u.organization_id = ?${userScope} AND (u.name LIKE ? OR u.email LIKE ?) LIMIT 4`,
      [orgId, ...userParams, like, like],
    ));
    for (const u of users) {
      hits.push({ id: String(u.id), kind: "user", title: String(u.name), subtitle: `User · ${String(u.email)}`, meta: String(u.job_title ?? ""), href: `/admin/users?highlight=${u.id}`, score: 1 });
    }
  }

  if (allowed.has("report")) {
    const reports = await query<Record<string, unknown>>(
      `SELECT r.id, r.title, r.category, r.period, r.filters FROM reports r
       WHERE r.organization_id = ? AND r.title LIKE ? AND r.status != 'archived'
       ORDER BY r.created_at DESC LIMIT 100`,
      [orgId, like],
    );
    let matchedReports = 0;
    for (const report of reports) {
      if (scopedStationIds !== undefined) {
        let filters: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(report.filters ?? "{}"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) filters = parsed as Record<string, unknown>;
        } catch {
          continue;
        }
        const reportStationId = filters.stationId;
        if (typeof reportStationId !== "string" || !scopedStationIds.includes(reportStationId)) continue;
      }
      hits.push({
        id: String(report.id),
        kind: "report",
        title: String(report.title),
        subtitle: `Report · ${String(report.category)}`,
        meta: String(report.period),
        href: `/reports/${report.id}`,
        score: 1,
      });
      matchedReports += 1;
      if (matchedReports >= 4) break;
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export { listAlertRules, listEnabledRules, HOUR, DAY };
