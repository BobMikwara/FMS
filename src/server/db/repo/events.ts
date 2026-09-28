import { execute, id, query, queryOne } from "../client";
import { parseJson } from "./core";
import type { FuelEvent } from "../../domain/types";

export interface EventFilter {
  orgId: string;
  stationId?: string;
  tankId?: string;
  vehicleId?: string;
  deviceId?: string;
  type?: string;
  types?: string[];
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  stationIds?: string[];
}

export async function listEvents(filter: EventFilter): Promise<{ rows: FuelEvent[]; total: number }> {
  const where: string[] = ["e.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.stationIds && filter.stationIds.length > 0) {
    where.push(`e.station_id IN (${filter.stationIds.map(() => "?").join(", ")})`);
    params.push(...filter.stationIds);
  }
  if (filter.stationId) {
    where.push("e.station_id = ?");
    params.push(filter.stationId);
  }
  if (filter.tankId) {
    where.push("e.tank_id = ?");
    params.push(filter.tankId);
  }
  if (filter.vehicleId) {
    where.push("e.vehicle_id = ?");
    params.push(filter.vehicleId);
  }
  if (filter.deviceId) {
    where.push("e.device_id = ?");
    params.push(filter.deviceId);
  }
  if (filter.type) {
    where.push("e.type = ?");
    params.push(filter.type);
  }
  if (filter.types && filter.types.length > 0) {
    where.push(`e.type IN (${filter.types.map(() => "?").join(", ")})`);
    params.push(...filter.types);
  }
  if (filter.status) {
    where.push("e.status = ?");
    params.push(filter.status);
  }
  if (filter.from) {
    where.push("e.ts >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("e.ts <= ?");
    params.push(filter.to);
  }
  if (filter.search) {
    where.push("(t.name LIKE ? OR s.name LIKE ? OR e.reason LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }
  const clause = `WHERE ${where.join(" AND ")}`;

  const total = Number(
    (await queryOne<{ n: number }>(
      `SELECT count(*) AS n FROM fuel_events e
       JOIN tanks t ON t.id = e.tank_id
       JOIN stations s ON s.id = e.station_id ${clause}`,
      params,
    ))?.n ?? 0,
  );
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 25));
  const rows = (await query<Record<string, unknown>>(
    `SELECT e.* FROM fuel_events e
     JOIN tanks t ON t.id = e.tank_id
     JOIN stations s ON s.id = e.station_id ${clause}
     ORDER BY e.ts DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ));
  return { rows: rows.map(mapEvent), total };
}

export async function listEventsForTank(tankId: string, from?: string, to?: string, limit = 200): Promise<FuelEvent[]> {
  const where: string[] = ["tank_id = ?"];
  const params: unknown[] = [tankId];
  if (from) {
    where.push("ts >= ?");
    params.push(from);
  }
  if (to) {
    where.push("ts <= ?");
    params.push(to);
  }
  return (await query<Record<string, unknown>>(
    `SELECT * FROM fuel_events WHERE ${where.join(" AND ")} ORDER BY ts DESC LIMIT ?`,
    [...params, limit],
  )).map(mapEvent);
}

export async function getEvent(eventId: string): Promise<FuelEvent | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM fuel_events WHERE id = ?", [eventId]));
  return row ? mapEvent(row) : null;
}

export async function createEvent(input: {
  ts: string;
  organizationId: string;
  stationId: string;
  tankId: string;
  deviceId?: string | null;
  vehicleId?: string | null;
  type: FuelEvent["type"];
  volume: number;
  levelBefore: number;
  levelAfter: number;
  durationSec?: number | null;
  confidence?: FuelEvent["confidence"];
  status?: FuelEvent["status"];
  reason?: string | null;
  note?: string | null;
}): Promise<FuelEvent> {
  const eventId = id("evt");
  (await execute(
    `INSERT INTO fuel_events (id, ts, organization_id, station_id, tank_id, device_id, vehicle_id, type,
       volume, level_before, level_after, duration_sec, confidence, status, reason, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      input.ts,
      input.organizationId,
      input.stationId,
      input.tankId,
      input.deviceId ?? null,
      input.vehicleId ?? null,
      input.type,
      input.volume,
      input.levelBefore,
      input.levelAfter,
      input.durationSec ?? null,
      input.confidence ?? "high",
      input.status ?? "confirmed",
      input.reason ?? null,
      input.note ?? null,
    ],
  ));
  return (await getEvent(eventId))!;
}

export async function deleteEvent(eventId: string): Promise<void> {
  (await execute("DELETE FROM fuel_events WHERE id = ?", [eventId]));
}

export async function updateEvent(eventId: string, patch: Record<string, unknown>): Promise<FuelEvent | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return (await getEvent(eventId));
  values.push(eventId);
  (await execute(`UPDATE fuel_events SET ${fields.join(", ")} WHERE id = ?`, values));
  return (await getEvent(eventId));
}

/* -------------------------------------------------------------------------- */
/* Aggregations used by dashboards and reports                                */
/* -------------------------------------------------------------------------- */

export interface MovementTotals {
  refills: number;
  refillCount: number;
  consumption: number;
  consumptionCount: number;
  suspectedLoss: number;
  anomalies: number;
}

export async function movementTotals(
  orgId: string,
  from: string,
  to: string,
  stationId?: string,
  tankId?: string,
  stationIds?: string[],
): Promise<MovementTotals> {
  const where: string[] = ["organization_id = ?", "ts >= ?", "ts <= ?"];
  const params: unknown[] = [orgId, from, to];
  if (stationIds && stationIds.length > 0) {
    where.push(`station_id IN (${stationIds.map(() => "?").join(", ")})`);
    params.push(...stationIds);
  }
  if (stationId) {
    where.push("station_id = ?");
    params.push(stationId);
  }
  if (tankId) {
    where.push("tank_id = ?");
    params.push(tankId);
  }
  const clause = where.join(" AND ");
  const row = (await queryOne<Record<string, unknown>>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'refill' THEN volume ELSE 0 END), 0) AS refills,
       COALESCE(SUM(CASE WHEN type = 'refill' THEN 1 ELSE 0 END), 0) AS refill_count,
       COALESCE(SUM(CASE WHEN type = 'consumption' THEN volume ELSE 0 END), 0) AS consumption,
       COALESCE(SUM(CASE WHEN type = 'consumption' THEN 1 ELSE 0 END), 0) AS consumption_count,
       COALESCE(SUM(CASE WHEN type = 'anomaly' AND status = 'suspected' THEN volume ELSE 0 END), 0) AS suspected_loss,
       COALESCE(SUM(CASE WHEN type = 'anomaly' THEN 1 ELSE 0 END), 0) AS anomalies
     FROM fuel_events WHERE ${clause}`,
    params,
  ));
  return {
    refills: Number(row?.refills ?? 0),
    refillCount: Number(row?.refill_count ?? 0),
    consumption: Number(row?.consumption ?? 0),
    consumptionCount: Number(row?.consumption_count ?? 0),
    suspectedLoss: Number(row?.suspected_loss ?? 0),
    anomalies: Number(row?.anomalies ?? 0),
  };
}

export interface BucketPoint {
  bucket: string;
  refills: number;
  consumption: number;
  anomalies: number;
}

/** Time-bucketed movement series for charts. */
export async function movementSeries(
  orgId: string,
  from: string,
  to: string,
  granularity: "hour" | "day",
  stationId?: string,
  tankId?: string,
  stationIds?: string[],
): Promise<BucketPoint[]> {
  const fmt = granularity === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";
  const where: string[] = ["organization_id = ?", "ts >= ?", "ts <= ?"];
  const params: unknown[] = [orgId, from, to];
  if (stationIds && stationIds.length > 0) {
    where.push(`station_id IN (${stationIds.map(() => "?").join(", ")})`);
    params.push(...stationIds);
  }
  if (stationId) {
    where.push("station_id = ?");
    params.push(stationId);
  }
  if (tankId) {
    where.push("tank_id = ?");
    params.push(tankId);
  }
  const clause = where.join(" AND ");
  return (await query<BucketPoint>(
    `SELECT strftime('${fmt}', ts) AS bucket,
            COALESCE(SUM(CASE WHEN type = 'refill' THEN volume ELSE 0 END), 0) AS refills,
            COALESCE(SUM(CASE WHEN type = 'consumption' THEN volume ELSE 0 END), 0) AS consumption,
            COALESCE(SUM(CASE WHEN type = 'anomaly' THEN 1 ELSE 0 END), 0) AS anomalies
     FROM fuel_events WHERE ${clause}
     GROUP BY bucket ORDER BY bucket ASC`,
    params,
  ));
}

/** Bucketed average tank level — used for the fuel-level trend chart. */
export async function levelSeries(
  orgId: string,
  from: string,
  to: string,
  granularity: "hour" | "day",
  stationId?: string,
  tankId?: string,
  stationIds?: string[],
): Promise<{ bucket: string; avgVolume: number; avgPercent: number }[]> {
  const fmt = granularity === "hour" ? "%Y-%m-%dT%H:00" : "%Y-%m-%d";
  const where: string[] = ["r.organization_id = ?", "r.ts >= ?", "r.ts <= ?"];
  const params: unknown[] = [orgId, from, to];
  if (stationIds && stationIds.length > 0) {
    where.push(`r.tank_id IN (SELECT id FROM tanks WHERE station_id IN (${stationIds.map(() => "?").join(", ")}))`);
    params.push(...stationIds);
  }
  if (stationId) {
    where.push("r.tank_id IN (SELECT id FROM tanks WHERE station_id = ?)");
    params.push(stationId);
  }
  if (tankId) {
    where.push("r.tank_id = ?");
    params.push(tankId);
  }
  const clause = where.join(" AND ");
  return (await query<{ bucket: string; avgVolume: number; avgPercent: number }>(
    `SELECT strftime('${fmt}', r.ts) AS bucket,
            AVG(r.volume_liters) AS avgVolume,
            AVG(r.level_percent) AS avgPercent
     FROM readings r WHERE ${clause}
     GROUP BY bucket ORDER BY bucket ASC`,
    params,
  ));
}

function mapEvent(row: Record<string, unknown>): FuelEvent {
  return {
    id: String(row.id),
    ts: String(row.ts),
    createdAt: String(row.created_at),
    organizationId: String(row.organization_id),
    stationId: String(row.station_id),
    tankId: String(row.tank_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    vehicleId: row.vehicle_id == null ? null : String(row.vehicle_id),
    type: String(row.type) as FuelEvent["type"],
    volume: Number(row.volume ?? 0),
    levelBefore: Number(row.level_before ?? 0),
    levelAfter: Number(row.level_after ?? 0),
    durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
    confidence: String(row.confidence ?? "high") as FuelEvent["confidence"],
    status: String(row.status ?? "confirmed") as FuelEvent["status"],
    reason: row.reason == null ? null : String(row.reason),
    note: row.note == null ? null : String(row.note),
  };
}

export { parseJson };
