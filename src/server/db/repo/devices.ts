import { execute, id, intToBool, query, queryOne, toIso } from "../client";
import { parseJson, snake } from "./core";
import type { Device, Vehicle } from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Devices (fuel probes + GPS trackers)                                       */
/* -------------------------------------------------------------------------- */

export interface DeviceFilter {
  orgId: string;
  type?: string;
  status?: string;
  /**
   * "ok" = the device is reporting; "problem" = offline, faulted or has never
   * connected. Kept separate from `status` so a caller can ask "which devices
   * are not reporting?" without enumerating every failure status.
   */
  reporting?: "ok" | "problem";
  stationId?: string;
  tankId?: string;
  vehicleId?: string;
  provider?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function listDevices(filter: DeviceFilter): { rows: Device[]; total: number } {
  const where: string[] = ["d.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.type) {
    where.push("d.type = ?");
    params.push(filter.type);
  }
  if (filter.status) {
    where.push("d.status = ?");
    params.push(filter.status);
  }
  if (filter.reporting === "ok") {
    where.push("d.status NOT IN ('offline', 'fault', 'never_connected')");
  } else if (filter.reporting === "problem") {
    where.push("d.status IN ('offline', 'fault', 'never_connected')");
  }
  if (filter.stationId) {
    where.push("d.station_id = ?");
    params.push(filter.stationId);
  }
  if (filter.tankId) {
    where.push("d.tank_id = ?");
    params.push(filter.tankId);
  }
  if (filter.vehicleId) {
    where.push("d.vehicle_id = ?");
    params.push(filter.vehicleId);
  }
  if (filter.provider) {
    where.push("d.provider = ?");
    params.push(filter.provider);
  }
  if (filter.search) {
    where.push("(d.serial_number LIKE ? OR d.label LIKE ? OR d.model LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }
  const clause = `WHERE ${where.join(" AND ")}`;

  const sortMap: Record<string, string> = {
    serial: "d.serial_number",
    status: "d.status",
    last_seen: "d.last_seen_at",
    created_at: "d.created_at",
    type: "d.type",
  };
  const sortColumn = sortMap[filter.sort ?? "created_at"] ?? "d.created_at";
  const direction = filter.order === "desc" ? "DESC" : "ASC";

  const total = Number(queryOne<{ n: number }>(`SELECT count(*) AS n FROM devices d ${clause}`, params)?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 24));
  const rows = query<Record<string, unknown>>(
    `SELECT d.* FROM devices d ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapDevice), total };
}

export function listAllDevices(orgId: string): Device[] {
  return query<Record<string, unknown>>(
    "SELECT * FROM devices WHERE organization_id = ? ORDER BY type, serial_number",
    [orgId],
  ).map(mapDevice);
}

export function getDevice(deviceId: string): Device | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM devices WHERE id = ?", [deviceId]);
  return row ? mapDevice(row) : null;
}

/**
 * Looks up a device by the SHA-256 hash of its ingest API key. Used by the
 * webhook endpoint to authenticate hardware without storing plaintext keys.
 */
export function getDeviceByApiKeyHash(hash: string): Device | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM devices WHERE api_key_hash = ?", [hash]);
  return row ? mapDevice(row) : null;
}

export function getDeviceBySerial(serial: string): Device | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM devices WHERE serial_number = ?", [serial]);
  return row ? mapDevice(row) : null;
}

export function createDevice(input: {
  organizationId: string;
  type: Device["type"];
  serialNumber: string;
  label?: string | null;
  provider?: string;
  model?: string | null;
  firmware?: string | null;
  stationId?: string | null;
  tankId?: string | null;
  vehicleId?: string | null;
  signalStrength?: number | null;
  batteryPct?: number | null;
  apiKeyHash?: string | null;
  metadata?: Record<string, unknown>;
}): Device {
  const deviceId = id("dev");
  execute(
    `INSERT INTO devices (id, organization_id, type, serial_number, label, provider, model, firmware,
       station_id, tank_id, vehicle_id, signal_strength, battery_pct, api_key_hash, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      deviceId,
      input.organizationId,
      input.type,
      input.serialNumber,
      input.label ?? null,
      input.provider ?? "tectonic",
      input.model ?? null,
      input.firmware ?? null,
      input.stationId ?? null,
      input.tankId ?? null,
      input.vehicleId ?? null,
      input.signalStrength ?? null,
      input.batteryPct ?? null,
      input.apiKeyHash ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return getDevice(deviceId)!;
}

export function updateDevice(deviceId: string, patch: Record<string, unknown>): Device | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getDevice(deviceId);
  values.push(deviceId);
  execute(`UPDATE devices SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getDevice(deviceId);
}

export function deleteDevice(deviceId: string): void {
  execute("DELETE FROM devices WHERE id = ?", [deviceId]);
}

export function countDevices(orgId: string, type?: string): number {
  const row = type
    ? queryOne<{ n: number }>("SELECT count(*) AS n FROM devices WHERE organization_id = ? AND type = ?", [
        orgId,
        type,
      ])
    : queryOne<{ n: number }>("SELECT count(*) AS n FROM devices WHERE organization_id = ?", [orgId]);
  return Number(row?.n ?? 0);
}

function mapDevice(row: Record<string, unknown>): Device {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    type: String(row.type) as Device["type"],
    serialNumber: String(row.serial_number),
    label: row.label == null ? null : String(row.label),
    provider: String(row.provider ?? "tectonic"),
    model: row.model == null ? null : String(row.model),
    firmware: row.firmware == null ? null : String(row.firmware),
    stationId: row.station_id == null ? null : String(row.station_id),
    tankId: row.tank_id == null ? null : String(row.tank_id),
    vehicleId: row.vehicle_id == null ? null : String(row.vehicle_id),
    status: String(row.status ?? "never_connected") as Device["status"],
    lastSeenAt: toIso(row.last_seen_at),
    lastReadingAt: toIso(row.last_reading_at),
    signalStrength: row.signal_strength == null ? null : Number(row.signal_strength),
    batteryPct: row.battery_pct == null ? null : Number(row.battery_pct),
    ipAddress: row.ip_address == null ? null : String(row.ip_address),
    apiKeyHash: row.api_key_hash == null ? null : String(row.api_key_hash),
    isActive: intToBool(row.is_active),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Vehicles                                                                   */
/* -------------------------------------------------------------------------- */

export interface VehicleFilter {
  orgId: string;
  status?: string;
  type?: string;
  stationId?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeArchived?: boolean;
}

export function listVehicles(filter: VehicleFilter): { rows: Vehicle[]; total: number } {
  const where: string[] = ["v.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (!filter.includeArchived) where.push("v.is_archived = 0");
  if (filter.status) {
    where.push("v.status = ?");
    params.push(filter.status);
  }
  if (filter.type) {
    where.push("v.type = ?");
    params.push(filter.type);
  }
  if (filter.stationId) {
    where.push("v.station_id = ?");
    params.push(filter.stationId);
  }
  if (filter.search) {
    where.push("(v.name LIKE ? OR v.plate_number LIKE ? OR v.driver_name LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }
  const clause = `WHERE ${where.join(" AND ")}`;

  const sortMap: Record<string, string> = {
    name: "v.name",
    plate: "v.plate_number",
    status: "v.status",
    created_at: "v.created_at",
  };
  const sortColumn = sortMap[filter.sort ?? "name"] ?? "v.name";
  const direction = filter.order === "desc" ? "DESC" : "ASC";

  const total = Number(queryOne<{ n: number }>(`SELECT count(*) AS n FROM vehicles v ${clause}`, params)?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 24));
  const rows = query<Record<string, unknown>>(
    `SELECT v.* FROM vehicles v ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapVehicle), total };
}

export function listAllVehicles(orgId: string): Vehicle[] {
  return query<Record<string, unknown>>(
    "SELECT * FROM vehicles WHERE organization_id = ? AND is_archived = 0 ORDER BY name",
    [orgId],
  ).map(mapVehicle);
}

export function getVehicle(vehicleId: string): Vehicle | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM vehicles WHERE id = ?", [vehicleId]);
  return row ? mapVehicle(row) : null;
}

export function createVehicle(input: {
  organizationId: string;
  name: string;
  plateNumber: string;
  type?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  fuelTypeId?: string | null;
  tankCapacity?: number | null;
  stationId?: string | null;
  status?: string;
  odometerKm?: number | null;
  driverName?: string | null;
  driverPhone?: string | null;
  notes?: string | null;
}): Vehicle {
  const vehicleId = id("veh");
  execute(
    `INSERT INTO vehicles (id, organization_id, name, plate_number, type, make, model, year, fuel_type_id,
       tank_capacity, station_id, status, odometer_km, driver_name, driver_phone, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      vehicleId,
      input.organizationId,
      input.name,
      input.plateNumber,
      input.type ?? "tanker",
      input.make ?? null,
      input.model ?? null,
      input.year ?? null,
      input.fuelTypeId ?? null,
      input.tankCapacity ?? null,
      input.stationId ?? null,
      input.status ?? "active",
      input.odometerKm ?? null,
      input.driverName ?? null,
      input.driverPhone ?? null,
      input.notes ?? null,
    ],
  );
  return getVehicle(vehicleId)!;
}

export function updateVehicle(vehicleId: string, patch: Record<string, unknown>): Vehicle | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getVehicle(vehicleId);
  values.push(vehicleId);
  execute(`UPDATE vehicles SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getVehicle(vehicleId);
}

export function deleteVehicle(vehicleId: string): void {
  execute("DELETE FROM vehicles WHERE id = ?", [vehicleId]);
}

function mapVehicle(row: Record<string, unknown>): Vehicle {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    plateNumber: String(row.plate_number),
    type: String(row.type ?? "tanker"),
    make: row.make == null ? null : String(row.make),
    model: row.model == null ? null : String(row.model),
    year: row.year == null ? null : Number(row.year),
    fuelTypeId: row.fuel_type_id == null ? null : String(row.fuel_type_id),
    tankCapacity: row.tank_capacity == null ? null : Number(row.tank_capacity),
    stationId: row.station_id == null ? null : String(row.station_id),
    status: String(row.status ?? "active") as Vehicle["status"],
    odometerKm: row.odometer_km == null ? null : Number(row.odometer_km),
    driverName: row.driver_name == null ? null : String(row.driver_name),
    driverPhone: row.driver_phone == null ? null : String(row.driver_phone),
    notes: row.notes == null ? null : String(row.notes),
    isArchived: intToBool(row.is_archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
