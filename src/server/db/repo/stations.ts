import { execute, id, intToBool, query, queryOne, toIso } from "../client";
import { parseJson, snake } from "./core";
import type { FuelType, Station, Tank } from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

export interface StationFilter {
  orgId: string;
  search?: string;
  status?: string;
  region?: string;
  city?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
}

export function listStations(filter: StationFilter): { rows: Station[]; total: number } {
  const where: string[] = ["s.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (!filter.includeArchived) where.push("s.is_archived = 0");
  if (filter.search) {
    where.push("(s.name LIKE ? OR s.code LIKE ? OR s.city LIKE ? OR s.region LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term, term);
  }
  if (filter.status) {
    where.push("s.status = ?");
    params.push(filter.status);
  }
  if (filter.city) {
    where.push("s.city = ?");
    params.push(filter.city);
  }
  if (filter.region) {
    where.push("s.region = ?");
    params.push(filter.region);
  }
  const clause = `WHERE ${where.join(" AND ")}`;

  const sortMap: Record<string, string> = {
    name: "s.name",
    code: "s.code",
    city: "s.city",
    status: "s.status",
    created_at: "s.created_at",
    updated_at: "s.updated_at",
  };
  const sortColumn = sortMap[filter.sort ?? "name"] ?? "s.name";
  const direction = filter.order === "desc" ? "DESC" : "ASC";

  const total = Number(queryOne<{ n: number }>(`SELECT count(*) AS n FROM stations s ${clause}`, params)?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 24));
  const rows = query<Record<string, unknown>>(
    `SELECT s.* FROM stations s ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapStation), total };
}

export function listAllStations(orgId: string, includeArchived = false): Station[] {
  const rows = query<Record<string, unknown>>(
    `SELECT * FROM stations WHERE organization_id = ? ${includeArchived ? "" : "AND is_archived = 0"} ORDER BY name`,
    [orgId],
  );
  return rows.map(mapStation);
}

export function getStation(stationId: string): Station | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM stations WHERE id = ?", [stationId]);
  return row ? mapStation(row) : null;
}

export function createStation(input: {
  organizationId: string;
  name: string;
  code: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  phone?: string | null;
  email?: string | null;
  latitude: number;
  longitude: number;
  status?: Station["status"];
  openingTime?: string;
  closingTime?: string;
  timezone?: string;
  currency?: string;
  volumeUnit?: string;
  notes?: string | null;
}): Station {
  const stationId = id("stn");
  execute(
    `INSERT INTO stations (id, organization_id, name, code, address, city, region, country, phone, email,
       latitude, longitude, status, opening_time, closing_time, timezone, currency, volume_unit, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      stationId,
      input.organizationId,
      input.name,
      input.code,
      input.address ?? "",
      input.city ?? "",
      input.region ?? "",
      input.country ?? "Tanzania",
      input.phone ?? null,
      input.email ?? null,
      input.latitude,
      input.longitude,
      input.status ?? "online",
      input.openingTime ?? "06:00",
      input.closingTime ?? "23:00",
      input.timezone ?? "Africa/Dar_es_Salaam",
      input.currency ?? "TZS",
      input.volumeUnit ?? "liters",
      input.notes ?? null,
    ],
  );
  return getStation(stationId)!;
}

export function updateStation(stationId: string, patch: Record<string, unknown>): Station | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getStation(stationId);
  values.push(stationId);
  execute(`UPDATE stations SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getStation(stationId);
}

export function deleteStation(stationId: string): void {
  execute("DELETE FROM stations WHERE id = ?", [stationId]);
}

function mapStation(row: Record<string, unknown>): Station {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    code: String(row.code),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    region: String(row.region ?? ""),
    country: String(row.country ?? "Tanzania"),
    phone: row.phone == null ? null : String(row.phone),
    email: row.email == null ? null : String(row.email),
    latitude: Number(row.latitude ?? 0),
    longitude: Number(row.longitude ?? 0),
    status: String(row.status) as Station["status"],
    openingTime: String(row.opening_time ?? "06:00"),
    closingTime: String(row.closing_time ?? "23:00"),
    timezone: String(row.timezone ?? "Africa/Dar_es_Salaam"),
    currency: String(row.currency ?? "TZS"),
    volumeUnit: String(row.volume_unit ?? "liters") as Station["volumeUnit"],
    notes: row.notes == null ? null : String(row.notes),
    isArchived: intToBool(row.is_archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Fuel types                                                                 */
/* -------------------------------------------------------------------------- */

export function listFuelTypes(orgId: string, activeOnly = false): FuelType[] {
  const rows = query<Record<string, unknown>>(
    `SELECT * FROM fuel_types WHERE organization_id = ? ${activeOnly ? "AND is_active = 1" : ""} ORDER BY system_name`,
    [orgId],
  );
  return rows.map(mapFuelType);
}

export function getFuelType(fuelTypeId: string): FuelType | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM fuel_types WHERE id = ?", [fuelTypeId]);
  return row ? mapFuelType(row) : null;
}

export function createFuelType(input: {
  organizationId: string;
  systemName: string;
  displayName: string;
  color?: string;
  density?: number | null;
}): FuelType {
  const fuelTypeId = id("ft");
  execute(
    `INSERT INTO fuel_types (id, organization_id, system_name, display_name, color, density)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      fuelTypeId,
      input.organizationId,
      input.systemName.toLowerCase().replace(/\s+/g, "_"),
      input.displayName,
      input.color ?? "#3b82f6",
      input.density ?? null,
    ],
  );
  return getFuelType(fuelTypeId)!;
}

export function updateFuelType(fuelTypeId: string, patch: Record<string, unknown>): FuelType | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getFuelType(fuelTypeId);
  values.push(fuelTypeId);
  execute(`UPDATE fuel_types SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getFuelType(fuelTypeId);
}

export function deleteFuelType(fuelTypeId: string): void {
  execute("DELETE FROM fuel_types WHERE id = ?", [fuelTypeId]);
}

function mapFuelType(row: Record<string, unknown>): FuelType {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    systemName: String(row.system_name),
    displayName: String(row.display_name),
    color: String(row.color ?? "#3b82f6"),
    density: row.density == null ? null : Number(row.density),
    isActive: intToBool(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Tanks                                                                      */
/* -------------------------------------------------------------------------- */

export interface TankFilter {
  orgId: string;
  stationId?: string;
  fuelTypeId?: string;
  status?: string;
  search?: string;
  lowOnly?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
  stationIds?: string[];
}

export function listTanks(filter: TankFilter): { rows: Tank[]; total: number } {
  const where: string[] = ["t.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (!filter.includeArchived) where.push("t.is_archived = 0");
  if (filter.stationId) {
    where.push("t.station_id = ?");
    params.push(filter.stationId);
  }
  if (filter.stationIds && filter.stationIds.length > 0) {
    where.push(`t.station_id IN (${filter.stationIds.map(() => "?").join(", ")})`);
    params.push(...filter.stationIds);
  }
  if (filter.fuelTypeId) {
    where.push("t.fuel_type_id = ?");
    params.push(filter.fuelTypeId);
  }
  if (filter.status) {
    where.push("t.status = ?");
    params.push(filter.status);
  }
  if (filter.search) {
    where.push("(t.name LIKE ? OR t.code LIKE ? OR s.name LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }
  const clause = `WHERE ${where.join(" AND ")}`;

  const sortMap: Record<string, string> = {
    name: "t.name",
    code: "t.code",
    capacity: "t.capacity",
    status: "t.status",
    level: "t.current_volume / t.capacity",
    station: "s.name",
    created_at: "t.created_at",
  };
  const sortColumn = sortMap[filter.sort ?? "name"] ?? "t.name";
  const direction = filter.order === "desc" ? "DESC" : "ASC";

  const total = Number(
    queryOne<{ n: number }>(`SELECT count(*) AS n FROM tanks t JOIN stations s ON s.id = t.station_id ${clause}`, params)
      ?.n ?? 0,
  );
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 24));
  const rows = query<Record<string, unknown>>(
    `SELECT t.* FROM tanks t JOIN stations s ON s.id = t.station_id ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapTank), total };
}

export function listAllTanks(orgId: string, includeArchived = false): Tank[] {
  const rows = query<Record<string, unknown>>(
    `SELECT * FROM tanks WHERE organization_id = ? ${includeArchived ? "" : "AND is_archived = 0"} ORDER BY name`,
    [orgId],
  );
  return rows.map(mapTank);
}

export function getTank(tankId: string): Tank | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM tanks WHERE id = ?", [tankId]);
  return row ? mapTank(row) : null;
}

export function createTank(input: {
  organizationId: string;
  stationId: string;
  fuelTypeId: string;
  name: string;
  code: string;
  capacity: number;
  currentVolume?: number;
  tankType?: string;
  manufacturer?: string | null;
  installationDate?: string | null;
  minLevel?: number;
  lowThresholdPct?: number;
  criticalThresholdPct?: number;
  overfillThresholdPct?: number;
  notes?: string | null;
}): Tank {
  const tankId = id("tnk");
  execute(
    `INSERT INTO tanks (id, organization_id, station_id, fuel_type_id, name, code, capacity, current_volume,
       tank_type, manufacturer, installation_date, min_level, low_threshold_pct, critical_threshold_pct,
       overfill_threshold_pct, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      tankId,
      input.organizationId,
      input.stationId,
      input.fuelTypeId,
      input.name,
      input.code,
      input.capacity,
      input.currentVolume ?? 0,
      input.tankType ?? "underground",
      input.manufacturer ?? null,
      input.installationDate ?? null,
      input.minLevel ?? 0,
      input.lowThresholdPct ?? 20,
      input.criticalThresholdPct ?? 10,
      input.overfillThresholdPct ?? 95,
      input.notes ?? null,
    ],
  );
  return getTank(tankId)!;
}

export function updateTank(tankId: string, patch: Record<string, unknown>): Tank | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getTank(tankId);
  values.push(tankId);
  execute(`UPDATE tanks SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getTank(tankId);
}

export function deleteTank(tankId: string): void {
  execute("DELETE FROM tanks WHERE id = ?", [tankId]);
}

export function countTanks(orgId: string, stationId?: string): number {
  const row = stationId
    ? queryOne<{ n: number }>("SELECT count(*) AS n FROM tanks WHERE organization_id = ? AND station_id = ?", [
        orgId,
        stationId,
      ])
    : queryOne<{ n: number }>("SELECT count(*) AS n FROM tanks WHERE organization_id = ?", [orgId]);
  return Number(row?.n ?? 0);
}

export function stationRegions(orgId: string): string[] {
  return query<{ region: string }>(
    "SELECT DISTINCT region FROM stations WHERE organization_id = ? AND region != '' ORDER BY region",
    [orgId],
  ).map((r) => r.region);
}

export function stationCities(orgId: string): string[] {
  return query<{ city: string }>(
    "SELECT DISTINCT city FROM stations WHERE organization_id = ? AND city != '' ORDER BY city",
    [orgId],
  ).map((r) => r.city);
}

function mapTank(row: Record<string, unknown>): Tank {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    stationId: String(row.station_id),
    fuelTypeId: String(row.fuel_type_id),
    name: String(row.name),
    code: String(row.code),
    capacity: Number(row.capacity ?? 0),
    currentVolume: Number(row.current_volume ?? 0),
    currentLevelMm: row.current_level_mm == null ? null : Number(row.current_level_mm),
    currentTempC: row.current_temp_c == null ? null : Number(row.current_temp_c),
    waterLevelMm: row.water_level_mm == null ? null : Number(row.water_level_mm),
    tankType: String(row.tank_type ?? "underground") as Tank["tankType"],
    manufacturer: row.manufacturer == null ? null : String(row.manufacturer),
    installationDate: toIso(row.installation_date),
    minLevel: Number(row.min_level ?? 0),
    lowThresholdPct: Number(row.low_threshold_pct ?? 20),
    criticalThresholdPct: Number(row.critical_threshold_pct ?? 10),
    overfillThresholdPct: Number(row.overfill_threshold_pct ?? 95),
    lastReadingAt: toIso(row.last_reading_at),
    lastValidReadingAt: toIso(row.last_valid_reading_at),
    status: String(row.status ?? "normal") as Tank["status"],
    notes: row.notes == null ? null : String(row.notes),
    isArchived: intToBool(row.is_archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export { parseJson };
