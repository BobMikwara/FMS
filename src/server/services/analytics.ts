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
import { getOrganization } from "../db/repo/core";
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

export function dayStart(offsetDays = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY).toISOString();
}

/** Device statuses that mean "this device is not reporting" (see DeviceFilter.reporting). */
const NOT_REPORTING = new Set(["offline", "fault", "never_connected"]);

export interface DateRange {
  from: string;
  to: string;
}

export function rangeFor(period: "today" | "7d" | "30d" | "90d" | "custom", from?: string, to?: string): DateRange {
  const now = new Date().toISOString();
  switch (period) {
    case "today":
      return { from: dayStart(0), to: now };
    case "7d":
      return { from: new Date(Date.now() - 7 * DAY).toISOString(), to: now };
    case "30d":
      return { from: new Date(Date.now() - 30 * DAY).toISOString(), to: now };
    case "90d":
      return { from: new Date(Date.now() - 90 * DAY).toISOString(), to: now };
    case "custom":
      return { from: from ?? dayStart(-7), to: to ?? now };
    default:
      return { from: dayStart(0), to: now };
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
): Promise<DashboardData> {
  const range = rangeFor(period);
  const today = rangeFor("today");
  const organization = (await getOrganization(orgId));
  const scopedStationIds = stationIds && stationIds.length > 0 ? stationIds : undefined;
  const allStations = await listAllStations(orgId);
  const stations = scopedStationIds ? allStations.filter((station) => scopedStationIds.includes(station.id)) : allStations;
  const allTanks = await listAllTanks(orgId);
  const tanks = scopedStationIds ? allTanks.filter((tank) => scopedStationIds.includes(tank.stationId)) : allTanks;
  const fuelTypes = (await listFuelTypes(orgId));
  const allDevices = await listAllDevices(orgId);
  const tankIds = new Set(tanks.map((tank) => tank.id));
  const devices = scopedStationIds
    ? allDevices.filter((device) => (device.stationId ? scopedStationIds.includes(device.stationId) : device.tankId ? tankIds.has(device.tankId) : false))
    : allDevices;
  const allVehicles = await listAllVehicles(orgId);
  const vehicles = scopedStationIds ? allVehicles.filter((vehicle) => vehicle.stationId && scopedStationIds.includes(vehicle.stationId)) : allVehicles;

  const fuelTypeById = new Map(fuelTypes.map((f) => [f.id, f]));
  const stationById = new Map(stations.map((s) => [s.id, s]));

  const alertsToday = (await listAlerts({
    orgId,
    status: "active",
    from: dayStart(0),
    to: new Date().toISOString(),
    pageSize: 200,
    stationIds: scopedStationIds,
  }));

  const activeAlerts = (await listAlerts({ orgId, status: "active", pageSize: 200, stationIds: scopedStationIds }));
  const todayTotals = (await movementTotals(orgId, today.from, today.to, undefined, undefined, scopedStationIds));
  const rangeTotals = (await movementTotals(orgId, range.from, range.to, undefined, undefined, scopedStationIds));

  const probes = devices.filter((d) => d.type === "fuel_probe");
  // The two buckets are complementary and use exactly the predicate behind
  // `GET /api/devices?reporting=problem`, so the KPI card, its deep link and the
  // devices table can never disagree.
  const onlineDevices = probes.filter((d) => !NOT_REPORTING.has(d.status)).length;
  const offlineDevices = probes.filter((d) => NOT_REPORTING.has(d.status)).length;

  /* ---- station summaries ---- */
  const stationsSummary: StationSummary[] = await Promise.all(stations.map(async (station) => {
    const stationTanks = tanks.filter((t) => t.stationId === station.id);
    const totalFuel = stationTanks.reduce((sum, t) => sum + t.currentVolume, 0);
    const capacity = stationTanks.reduce((sum, t) => sum + t.capacity, 0);
    const utilizationPct = capacity > 0 ? (totalFuel / capacity) * 100 : 0;
    const avgLevelPct =
      stationTanks.length > 0
        ? stationTanks.reduce((sum, t) => sum + (t.capacity > 0 ? (t.currentVolume / t.capacity) * 100 : 0), 0) /
          stationTanks.length
        : 0;
    const stationDevices = probes.filter((d) => d.stationId === station.id);
    const stationAlerts = (await listAlerts({ orgId, stationId: station.id, status: "active", pageSize: 200 })).total;
    const stToday = (await movementTotals(orgId, today.from, today.to, station.id));
    const worst =
      stationTanks.some((t) => t.status === "offline") || stationDevices.every((d) => d.status !== "online" && stationDevices.length > 0)
        ? "offline"
        : stationTanks.some((t) => t.status === "critical")
          ? "critical"
          : stationTanks.some((t) => t.status === "low")
            ? "warning"
            : "online";
    return {
      station,
      tankCount: stationTanks.length,
      totalFuel,
      capacity,
      utilizationPct,
      avgLevelPct,
      lowTanks: stationTanks.filter((t) => t.status === "low").length,
      criticalTanks: stationTanks.filter((t) => t.status === "critical").length,
      activeAlerts: stationAlerts,
      onlineDevices: stationDevices.filter((d) => !NOT_REPORTING.has(d.status)).length,
      offlineDevices: stationDevices.filter((d) => NOT_REPORTING.has(d.status)).length,
      todayConsumption: stToday.consumption,
      todayRefills: stToday.refills,
      status: worst,
    };
  }));

  /* ---- charts ---- */
  const granularity: "hour" | "day" = period === "today" ? "hour" : "day";
  const levelTrend = (await levelSeries(orgId, range.from, range.to, granularity, undefined, undefined, scopedStationIds));
  const movements = (await movementSeries(orgId, range.from, range.to, granularity, undefined, undefined, scopedStationIds));
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

  const stationScopeSql = scopedStationIds ? ` AND station_id IN (${scopedStationIds.map(() => "?").join(", ")})` : "";
  const stationScopeParams = scopedStationIds ?? [];
  const lossSeries = (await query<{ bucket: string; loss: number }>(
    `SELECT strftime('${granularity === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d"}', ts) AS bucket,
            COALESCE(SUM(CASE WHEN type = 'anomaly' THEN volume ELSE 0 END), 0) AS loss
     FROM fuel_events WHERE organization_id = ? AND ts >= ? AND ts <= ?${stationScopeSql}
     GROUP BY bucket ORDER BY bucket ASC`,
    [orgId, range.from, range.to, ...stationScopeParams],
  ));

  const alertFrequency = (await query<{ bucket: string; critical: number; warning: number; info: number }>(
    `SELECT strftime('${granularity === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d"}', created_at) AS bucket,
            COALESCE(SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END), 0) AS critical,
            COALESCE(SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END), 0) AS warning,
            COALESCE(SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END), 0) AS info
     FROM alerts WHERE organization_id = ? AND created_at >= ? AND created_at <= ?${stationScopeSql}
     GROUP BY bucket ORDER BY bucket ASC`,
    [orgId, range.from, range.to, ...stationScopeParams],
  ));

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

  return {
    generatedAt: new Date().toISOString(),
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
      criticalAlerts: activeAlerts.rows.filter((a) => a.severity === "critical").length,
      warningAlerts: activeAlerts.rows.filter((a) => a.severity === "warning").length,
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
    deviceHealth: probes.slice(0, 8),
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
  dataState: "live" | "delayed" | "stale" | "offline";
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
  const station = (await getStation(tank.stationId));
  const fuelType = (await getFuelType(tank.fuelTypeId));
  const devices = (await listAllDevices(tank.organizationId));
  const device = devices.find((d) => d.tankId === tank.id && d.type === "fuel_probe") ?? null;
  const latestReading = (await latestReadingForTank(tank.id));

  const fillPercent = tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0;
  const remainingCapacity = Math.max(0, tank.capacity - tank.currentVolume);

  const lastUpdate = tank.lastReadingAt ? new Date(tank.lastReadingAt) : null;
  const lastUpdateAgeMinutes = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 60000 : Infinity;
  const dataState: TankDetail["dataState"] =
    !device || device.status === "offline" || !Number.isFinite(lastUpdateAgeMinutes)
      ? "offline"
      : lastUpdateAgeMinutes > 30
        ? "stale"
        : lastUpdateAgeMinutes > 3
          ? "delayed"
          : "live";

  const today = rangeFor("today");
  const range = rangeFor(period === "24h" ? "today" : (period.toLowerCase() as "7d" | "30d" | "90d"));
  const totals = (await movementTotals(tank.organizationId, range.from, range.to, undefined, tank.id));
  const granularity: "hour" | "day" = period === "24h" ? "hour" : "day";

  const history = (await query<{ bucket: string; avgVolume: number; avgPercent: number; avgTemp: number; avgWater: number }>(
    `SELECT strftime('${granularity === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d"}', ts) AS bucket,
            AVG(volume_liters) AS avgVolume,
            AVG(level_percent) AS avgPercent,
            AVG(temperature_c) AS avgTemp,
            AVG(water_level_mm) AS avgWater
     FROM readings WHERE tank_id = ? AND ts >= ? AND ts <= ?
     GROUP BY bucket ORDER BY bucket ASC`,
    [tank.id, range.from, range.to],
  ));

  const eventsPage = (await listEvents({ orgId: tank.organizationId, tankId: tank.id, page: 1, pageSize: 40 }));
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

  const alerts = (await listAlerts({ orgId: tank.organizationId, tankId: tank.id, pageSize: 50 })).rows;

  const recentReadings = (await query<Record<string, unknown>>(
    `SELECT r.*, d.serial_number AS device_serial FROM readings r JOIN devices d ON d.id = r.device_id
     WHERE r.tank_id = ? ORDER BY r.ts DESC LIMIT 40`,
    [tank.id],
  )).map((row) => ({
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
    todayConsumption: Math.round(totals.consumption),
    todayRefills: Math.round(totals.refills),
    coverage: (await stockCoverage(tank.id)),
    reconciliation: (await reconcileTank(tank.id, range.from, range.to)),
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
  const tanks = (await listAllTanks(station.organizationId)).filter((t) => t.stationId === station.id);
  const fuelTypes = (await listFuelTypes(station.organizationId));
  const devices = (await listAllDevices(station.organizationId)).filter((d) => d.stationId === station.id);
  const range = rangeFor(period);
  const today = rangeFor("today");
  const totals = (await movementTotals(station.organizationId, range.from, range.to, station.id));
  const todayTotals = (await movementTotals(station.organizationId, today.from, today.to, station.id));
  const alerts = (await listAlerts({ orgId: station.organizationId, stationId: station.id, pageSize: 100 }));
  const totalFuel = tanks.reduce((s, t) => s + t.currentVolume, 0);
  const capacity = tanks.reduce((s, t) => s + t.capacity, 0);
  const movements = (await listEvents({ orgId: station.organizationId, stationId: station.id, page: 1, pageSize: 12 }));

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
    levelTrend: (await levelSeries(station.organizationId, range.from, range.to, period === "today" ? "hour" : "day", station.id)),
    movementTrend: (await movementSeries(station.organizationId, range.from, range.to, period === "today" ? "hour" : "day", station.id)),
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

export async function globalSearch(orgId: string, term: string, limit = 12, stationIds?: string[]): Promise<SearchHit[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 1) return [];
  const like = `%${q}%`;
  const scopedStationIds = stationIds && stationIds.length > 0 ? stationIds : undefined;
  const stationPlaceholders = scopedStationIds?.map(() => "?").join(", ");
  const hits: SearchHit[] = [];

  const stations = (await query<Record<string, unknown>>(
    `SELECT id, name, code, city, status FROM stations WHERE organization_id = ?${scopedStationIds ? ` AND id IN (${stationPlaceholders})` : ""} AND (name LIKE ? OR code LIKE ? OR city LIKE ?) LIMIT 6`,
    scopedStationIds ? [orgId, ...scopedStationIds, like, like, like] : [orgId, like, like, like],
  ));
  for (const s of stations) {
    hits.push({
      id: String(s.id),
      kind: "station",
      title: String(s.name),
      subtitle: `Station ${String(s.code)} · ${String(s.city)}`,
      meta: String(s.status),
      href: `/stations/${s.id}`,
      score: 3,
    });
  }

  const tanks = (await query<Record<string, unknown>>(
    `SELECT t.id, t.name, t.capacity, t.current_volume, s.name AS station_name, ft.system_name AS fuel
     FROM tanks t JOIN stations s ON s.id = t.station_id JOIN fuel_types ft ON ft.id = t.fuel_type_id
     WHERE t.organization_id = ?${scopedStationIds ? ` AND t.station_id IN (${stationPlaceholders})` : ""} AND (t.name LIKE ? OR t.code LIKE ? OR s.name LIKE ?) LIMIT 6`,
    scopedStationIds ? [orgId, ...scopedStationIds, like, like, like] : [orgId, like, like, like],
  ));
  for (const t of tanks) {
    const pct = Number(t.capacity) > 0 ? (Number(t.current_volume) / Number(t.capacity)) * 100 : 0;
    hits.push({
      id: String(t.id),
      kind: "tank",
      title: String(t.name),
      subtitle: `${String(t.station_name)} · ${String(t.fuel)}`,
      meta: `${Math.round(Number(t.current_volume)).toLocaleString()} L · ${pct.toFixed(0)}%`,
      href: `/tanks/${t.id}`,
      score: 3,
    });
  }

  const devices = (await query<Record<string, unknown>>(
    `SELECT id, serial_number, type, status, label FROM devices
     WHERE organization_id = ?${scopedStationIds ? ` AND station_id IN (${stationPlaceholders})` : ""} AND (serial_number LIKE ? OR label LIKE ?) LIMIT 6`,
    scopedStationIds ? [orgId, ...scopedStationIds, like, like] : [orgId, like, like],
  ));
  for (const d of devices) {
    hits.push({
      id: String(d.id),
      kind: "device",
      title: String(d.serial_number),
      subtitle: `${d.type === "fuel_probe" ? "Fuel probe" : "GPS tracker"}${d.label ? ` · ${String(d.label)}` : ""}`,
      meta: String(d.status).replace("_", " "),
      href: `/devices/${d.id}`,
      score: 2,
    });
  }

  const vehicles = (await query<Record<string, unknown>>(
    `SELECT id, name, plate_number, status FROM vehicles WHERE organization_id = ?${scopedStationIds ? ` AND station_id IN (${stationPlaceholders})` : ""} AND (name LIKE ? OR plate_number LIKE ?) LIMIT 4`,
    scopedStationIds ? [orgId, ...scopedStationIds, like, like] : [orgId, like, like],
  ));
  for (const v of vehicles) {
    hits.push({
      id: String(v.id),
      kind: "vehicle",
      title: String(v.name),
      subtitle: `Vehicle · ${String(v.plate_number)}`,
      meta: String(v.status),
      href: `/vehicles/${v.id}`,
      score: 2,
    });
  }

  const alerts = (await query<Record<string, unknown>>(
    `SELECT id, title, severity, status, type FROM alerts WHERE organization_id = ?${scopedStationIds ? ` AND station_id IN (${stationPlaceholders})` : ""} AND (title LIKE ? OR message LIKE ?) LIMIT 4`,
    scopedStationIds ? [orgId, ...scopedStationIds, like, like] : [orgId, like, like],
  ));
  for (const a of alerts) {
    hits.push({
      id: String(a.id),
      kind: "alert",
      title: String(a.title),
      subtitle: `Alert · ${String(a.type).replace(/_/g, " ")}`,
      meta: String(a.status),
      href: `/alerts?highlight=${a.id}`,
      score: 2,
    });
  }

  const users = (await query<Record<string, unknown>>(
    `SELECT id, name, email, job_title FROM users WHERE organization_id = ? AND (name LIKE ? OR email LIKE ?) LIMIT 4`,
    [orgId, like, like],
  ));
  for (const u of users) {
    hits.push({
      id: String(u.id),
      kind: "user",
      title: String(u.name),
      subtitle: `User · ${String(u.email)}`,
      meta: String(u.job_title ?? ""),
      href: `/admin/users?highlight=${u.id}`,
      score: 1,
    });
  }

  const reports = (await query<Record<string, unknown>>(
    `SELECT id, title, category, period FROM reports WHERE organization_id = ? AND title LIKE ? LIMIT 4`,
    [orgId, like],
  ));
  for (const r of reports) {
    hits.push({
      id: String(r.id),
      kind: "report",
      title: String(r.title),
      subtitle: `Report · ${String(r.category)}`,
      meta: String(r.period),
      href: `/reports/${r.id}`,
      score: 1,
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export { listAlertRules, listEnabledRules, HOUR, DAY };
