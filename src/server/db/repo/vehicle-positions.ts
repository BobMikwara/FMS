import { createHash } from "node:crypto";
import { execute, id, intToBool, query, queryOne, toIso } from "../client";
import type { NormalizedVehiclePosition, VehiclePosition } from "../../domain/types";

export interface VehiclePositionFilter {
  organizationId: string;
  vehicleId: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface InsertVehiclePositionResult {
  position: VehiclePosition;
  inserted: boolean;
}

export async function insertVehiclePosition(input: {
  organizationId: string;
  vehicleId: string;
  deviceId: string;
  receivedAt: string;
  position: NormalizedVehiclePosition;
}): Promise<InsertVehiclePositionResult> {
  const eventKey = input.position.eventKey ?? createHash("sha256")
    .update([
      input.position.ts,
      input.position.latitude.toFixed(7),
      input.position.longitude.toFixed(7),
      input.position.speedKph ?? "",
      input.position.headingDeg ?? "",
      input.position.ignition ?? "",
      input.position.odometerKm ?? "",
    ].join("\0"))
    .digest("hex");
  const positionId = id("pos");
  const result = await execute(
    `INSERT INTO vehicle_positions (
       id, organization_id, vehicle_id, device_id, ts, received_at, latitude, longitude,
       speed_kph, heading_deg, ignition, odometer_km, event_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (device_id, event_key) DO NOTHING`,
    [
      positionId,
      input.organizationId,
      input.vehicleId,
      input.deviceId,
      input.position.ts,
      input.receivedAt,
      input.position.latitude,
      input.position.longitude,
      input.position.speedKph,
      input.position.headingDeg,
      input.position.ignition === null ? null : input.position.ignition ? 1 : 0,
      input.position.odometerKm,
      eventKey,
    ],
  );
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM vehicle_positions WHERE device_id = ? AND event_key = ?",
    [input.deviceId, eventKey],
  );
  if (!row) throw new Error("Could not verify the stored GPS position");
  return { position: mapVehiclePosition(row), inserted: result.changes > 0 };
}

export async function latestPositionForVehicle(
  organizationId: string,
  vehicleId: string,
): Promise<VehiclePosition | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM vehicle_positions
     WHERE organization_id = ? AND vehicle_id = ?
     ORDER BY ts DESC, received_at DESC, id DESC LIMIT 1`,
    [organizationId, vehicleId],
  );
  return row ? mapVehiclePosition(row) : null;
}

export async function latestPositionsForVehicles(
  organizationId: string,
  vehicleIds?: string[],
  deviceIds?: string[],
): Promise<Map<string, VehiclePosition>> {
  if ((vehicleIds !== undefined && vehicleIds.length === 0) || (deviceIds !== undefined && deviceIds.length === 0)) return new Map();
  const vehicleClause = vehicleIds === undefined ? "" : ` AND vehicle_id IN (${vehicleIds.map(() => "?").join(", ")})`;
  const deviceClause = deviceIds === undefined ? "" : ` AND device_id IN (${deviceIds.map(() => "?").join(", ")})`;
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM (
       SELECT vp.*, ROW_NUMBER() OVER (
         PARTITION BY vehicle_id ORDER BY ts DESC, received_at DESC, id DESC
       ) AS position_rank
       FROM vehicle_positions vp
       WHERE organization_id = ?${vehicleClause}${deviceClause}
     ) latest
     WHERE position_rank = 1`,
    [organizationId, ...(vehicleIds ?? []), ...(deviceIds ?? [])],
  );
  return new Map(rows.map((row) => {
    const position = mapVehiclePosition(row);
    return [position.vehicleId, position];
  }));
}

export async function listVehiclePositions(filter: VehiclePositionFilter): Promise<{
  rows: VehiclePosition[];
  total: number;
}> {
  const where = ["organization_id = ?", "vehicle_id = ?"];
  const params: unknown[] = [filter.organizationId, filter.vehicleId];
  if (filter.from) {
    where.push("ts >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("ts <= ?");
    params.push(filter.to);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const total = Number((await queryOne<{ n: number }>(
    `SELECT count(*) AS n FROM vehicle_positions ${clause}`,
    params,
  ))?.n ?? 0);
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Math.floor(filter.pageSize ?? 100)));
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM vehicle_positions ${clause}
     ORDER BY ts DESC, received_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapVehiclePosition), total };
}

function mapVehiclePosition(row: Record<string, unknown>): VehiclePosition {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    vehicleId: String(row.vehicle_id),
    deviceId: String(row.device_id),
    ts: toIso(row.ts) ?? String(row.ts),
    receivedAt: toIso(row.received_at) ?? String(row.received_at),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    speedKph: row.speed_kph == null ? null : Number(row.speed_kph),
    headingDeg: row.heading_deg == null ? null : Number(row.heading_deg),
    ignition: row.ignition == null ? null : intToBool(row.ignition),
    odometerKm: row.odometer_km == null ? null : Number(row.odometer_km),
    eventKey: String(row.event_key),
  };
}
