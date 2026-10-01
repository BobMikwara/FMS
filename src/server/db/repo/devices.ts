import { execute, id, intToBool, isPostgres, query, queryOne, toIso } from "../client";
import { parseJson, snake } from "./core";
import type { Device, Vehicle } from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Devices (fuel probes + GPS trackers)                                       */
/* -------------------------------------------------------------------------- */

export interface DeviceFilter {
  orgId: string;
  type?: string;
  status?: string;
  isActive?: boolean;
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
  stationIds?: string[];
}

export async function listDevices(filter: DeviceFilter): Promise<{ rows: Device[]; total: number }> {
  const where: string[] = ["d.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.stationIds !== undefined) {
    if (filter.stationIds.length === 0) {
      where.push("1 = 0");
    } else {
      const stationPlaceholders = filter.stationIds.map(() => "?").join(", ");
      where.push(`(
        (d.station_id IS NULL OR d.station_id IN (${stationPlaceholders}))
        AND (d.tank_id IS NULL OR d.tank_id IN (SELECT t.id FROM tanks t WHERE t.organization_id = ? AND t.station_id IN (${stationPlaceholders})))
        AND (d.vehicle_id IS NULL OR d.vehicle_id IN (SELECT v.id FROM vehicles v WHERE v.organization_id = ? AND v.station_id IN (${stationPlaceholders})))
        AND (
          d.station_id IN (${stationPlaceholders})
          OR d.tank_id IN (SELECT t.id FROM tanks t WHERE t.organization_id = ? AND t.station_id IN (${stationPlaceholders}))
          OR d.vehicle_id IN (SELECT v.id FROM vehicles v WHERE v.organization_id = ? AND v.station_id IN (${stationPlaceholders}))
        )
      )`);
      params.push(
        ...filter.stationIds,
        filter.orgId, ...filter.stationIds,
        filter.orgId, ...filter.stationIds,
        ...filter.stationIds,
        filter.orgId, ...filter.stationIds,
        filter.orgId, ...filter.stationIds,
      );
    }
  }
  if (filter.type) {
    where.push("d.type = ?");
    params.push(filter.type);
  }
  if (filter.status) {
    where.push("d.status = ?");
    params.push(filter.status);
  }
  if (filter.isActive !== undefined) {
    where.push("d.is_active = ?");
    params.push(filter.isActive ? 1 : 0);
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

  const total = Number((await queryOne<{ n: number }>(`SELECT count(*) AS n FROM devices d ${clause}`, params))?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 24));
  const rows = (await query<Record<string, unknown>>(
    `SELECT d.* FROM devices d ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ));
  return { rows: rows.map(mapDevice), total };
}

export async function listAllDevices(orgId: string): Promise<Device[]> {
  return (await query<Record<string, unknown>>(
    "SELECT * FROM devices WHERE organization_id = ? ORDER BY type, serial_number",
    [orgId],
  )).map(mapDevice);
}

export async function hasActiveFuelProbe(tankId: string, exceptDeviceId?: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM devices
     WHERE tank_id = ? AND type = 'fuel_probe' AND is_active = 1${exceptDeviceId ? " AND id <> ?" : ""}
     LIMIT 1`,
    exceptDeviceId ? [tankId, exceptDeviceId] : [tankId],
  );
  return Boolean(row);
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM devices WHERE id = ?", [deviceId]));
  return row ? mapDevice(row) : null;
}

/** Lock one device while a transactional health sweep creates its transition alert. */
export async function lockDeviceForUpdate(deviceId: string): Promise<void> {
  const lockClause = isPostgres() ? " FOR UPDATE" : "";
  await queryOne(`SELECT id FROM devices WHERE id = ?${lockClause}`, [deviceId]);
}

/**
 * Looks up a device by the SHA-256 hash of its ingest API key. Used by the
 * webhook endpoint to authenticate hardware without storing plaintext keys.
 */
export async function getDeviceByApiKeyHash(hash: string): Promise<Device | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM devices WHERE api_key_hash = ?", [hash]));
  return row ? mapDevice(row) : null;
}

export async function getDeviceBySerial(serial: string): Promise<Device | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM devices WHERE serial_number = ?", [serial]));
  return row ? mapDevice(row) : null;
}

export async function createDevice(input: {
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
}): Promise<Device> {
  const deviceId = id("dev");
  (await execute(
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
  ));
  return (await getDevice(deviceId))!;
}

export async function updateDevice(deviceId: string, patch: Record<string, unknown>): Promise<Device | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return (await getDevice(deviceId));
  values.push(deviceId);
  (await execute(`UPDATE devices SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getDevice(deviceId));
}

export async function retireDevice(deviceId: string): Promise<Device | null> {
  return (await updateDevice(deviceId, { isActive: false, status: "offline" }));
}

export async function countDevices(orgId: string, type?: string): Promise<number> {
  const row = type
    ? (await queryOne<{ n: number }>("SELECT count(*) AS n FROM devices WHERE organization_id = ? AND type = ?", [
        orgId,
        type,
      ]))
    : (await queryOne<{ n: number }>("SELECT count(*) AS n FROM devices WHERE organization_id = ?", [orgId]));
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
  archivedOnly?: boolean;
  stationIds?: string[];
}

export async function listVehicles(filter: VehicleFilter): Promise<{ rows: Vehicle[]; total: number }> {
  const where: string[] = ["v.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.archivedOnly) where.push("v.is_archived = 1");
  else if (!filter.includeArchived) {
    where.push("v.is_archived = 0");
    where.push("(v.station_id IS NULL OR s.is_archived = 0)");
  }
  if (filter.stationIds !== undefined) {
    if (filter.stationIds.length === 0) where.push("1 = 0");
    else {
      where.push(`v.station_id IN (${filter.stationIds.map(() => "?").join(", ")})`);
      params.push(...filter.stationIds);
    }
  }
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

  const total = Number((await queryOne<{ n: number }>(`SELECT count(*) AS n FROM vehicles v LEFT JOIN stations s ON s.id = v.station_id ${clause}`, params))?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 24));
  const rows = (await query<Record<string, unknown>>(
    `SELECT v.* FROM vehicles v LEFT JOIN stations s ON s.id = v.station_id ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ));
  return { rows: rows.map(mapVehicle), total };
}

export async function listAllVehicles(orgId: string, includeArchived = false): Promise<Vehicle[]> {
  return (await query<Record<string, unknown>>(
    `SELECT v.* FROM vehicles v LEFT JOIN stations s ON s.id = v.station_id
     WHERE v.organization_id = ?${includeArchived ? "" : " AND v.is_archived = 0 AND (v.station_id IS NULL OR s.is_archived = 0)"}
     ORDER BY v.name`,
    [orgId],
  )).map(mapVehicle);
}

export async function getVehicle(vehicleId: string): Promise<Vehicle | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM vehicles WHERE id = ?", [vehicleId]));
  return row ? mapVehicle(row) : null;
}

export async function createVehicle(input: {
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
}): Promise<Vehicle> {
  const vehicleId = id("veh");
  (await execute(
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
  ));
  return (await getVehicle(vehicleId))!;
}

export async function updateVehicle(vehicleId: string, patch: Record<string, unknown>): Promise<Vehicle | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return (await getVehicle(vehicleId));
  values.push(vehicleId);
  (await execute(`UPDATE vehicles SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getVehicle(vehicleId));
}

export async function archiveVehicle(vehicleId: string): Promise<Vehicle | null> {
  return (await updateVehicle(vehicleId, { isArchived: true }));
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
