import { execute, id, insertMany, query, queryOne } from "../client";
import { parseJson } from "./core";
import type { Reading } from "../../domain/types";

/**
 * Readings are the immutable, append-only record of what a device actually
 * reported. Nothing in this file interprets data — interpretation lives in the
 * event engine (`src/server/engine`).
 */

export interface ReadingInput {
  ts: string;
  organizationId: string;
  tankId: string;
  deviceId: string;
  volumeLiters: number;
  levelPercent?: number | null;
  levelMm?: number | null;
  temperatureC?: number | null;
  waterLevelMm?: number | null;
  signal?: number | null;
  batteryPct?: number | null;
  raw?: Record<string, unknown> | null;
}

export function insertReading(input: ReadingInput): Reading {
  const readingId = id("rdg");
  execute(
    `INSERT INTO readings (id, ts, organization_id, tank_id, device_id, volume_liters, level_percent,
       level_mm, temperature_c, water_level_mm, signal, battery_pct, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      readingId,
      input.ts,
      input.organizationId,
      input.tankId,
      input.deviceId,
      input.volumeLiters,
      input.levelPercent ?? null,
      input.levelMm ?? null,
      input.temperatureC ?? null,
      input.waterLevelMm ?? null,
      input.signal ?? null,
      input.batteryPct ?? null,
      input.raw ? JSON.stringify(input.raw) : null,
    ],
  );
  return getReading(readingId)!;
}

export function insertReadingsBulk(inputs: ReadingInput[]): number {
  return insertMany(
    "readings",
    [
      "id",
      "ts",
      "organization_id",
      "tank_id",
      "device_id",
      "volume_liters",
      "level_percent",
      "level_mm",
      "temperature_c",
      "water_level_mm",
      "signal",
      "battery_pct",
      "raw",
    ],
    inputs.map((input) => [
      id("rdg"),
      input.ts,
      input.organizationId,
      input.tankId,
      input.deviceId,
      input.volumeLiters,
      input.levelPercent ?? null,
      input.levelMm ?? null,
      input.temperatureC ?? null,
      input.waterLevelMm ?? null,
      input.signal ?? null,
      input.batteryPct ?? null,
      input.raw ? JSON.stringify(input.raw) : null,
    ]),
    500,
  );
}

export function getReading(readingId: string): Reading | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM readings WHERE id = ?", [readingId]);
  return row ? mapReading(row) : null;
}

export function latestReadingForTank(tankId: string): Reading | null {
  const row = queryOne<Record<string, unknown>>(
    "SELECT * FROM readings WHERE tank_id = ? ORDER BY ts DESC LIMIT 1",
    [tankId],
  );
  return row ? mapReading(row) : null;
}

export function latestReadingForDevice(deviceId: string): Reading | null {
  const row = queryOne<Record<string, unknown>>(
    "SELECT * FROM readings WHERE device_id = ? ORDER BY ts DESC LIMIT 1",
    [deviceId],
  );
  return row ? mapReading(row) : null;
}

export function readingsForTank(
  tankId: string,
  from: string,
  to: string,
  limit = 2000,
): Reading[] {
  return query<Record<string, unknown>>(
    "SELECT * FROM readings WHERE tank_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC LIMIT ?",
    [tankId, from, to, limit],
  ).map(mapReading);
}

export interface ReadingPageFilter {
  orgId: string;
  tankId?: string;
  deviceId?: string;
  stationId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listReadings(filter: ReadingPageFilter): { rows: Reading[]; total: number } {
  const where: string[] = ["r.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.tankId) {
    where.push("r.tank_id = ?");
    params.push(filter.tankId);
  }
  if (filter.deviceId) {
    where.push("r.device_id = ?");
    params.push(filter.deviceId);
  }
  if (filter.stationId) {
    where.push("r.tank_id IN (SELECT id FROM tanks WHERE station_id = ?)");
    params.push(filter.stationId);
  }
  if (filter.from) {
    where.push("r.ts >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("r.ts <= ?");
    params.push(filter.to);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const total = Number(queryOne<{ n: number }>(`SELECT count(*) AS n FROM readings r ${clause}`, params)?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(500, Math.max(5, filter.pageSize ?? 50));
  const rows = query<Record<string, unknown>>(
    `SELECT r.* FROM readings r ${clause} ORDER BY r.ts DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapReading), total };
}

export function countReadings(orgId: string): number {
  return Number(queryOne<{ n: number }>("SELECT count(*) AS n FROM readings WHERE organization_id = ?", [orgId])?.n ?? 0);
}

/** Removes raw readings older than the retention window (data lifecycle). */
export function pruneReadings(orgId: string, olderThanIso: string): number {
  const result = execute("DELETE FROM readings WHERE organization_id = ? AND ts < ?", [orgId, olderThanIso]);
  return result.changes;
}

function mapReading(row: Record<string, unknown>): Reading {
  return {
    id: String(row.id),
    ts: String(row.ts),
    createdAt: String(row.created_at),
    organizationId: String(row.organization_id),
    tankId: String(row.tank_id),
    deviceId: String(row.device_id),
    volumeLiters: Number(row.volume_liters ?? 0),
    levelPercent: row.level_percent == null ? null : Number(row.level_percent),
    levelMm: row.level_mm == null ? null : Number(row.level_mm),
    temperatureC: row.temperature_c == null ? null : Number(row.temperature_c),
    waterLevelMm: row.water_level_mm == null ? null : Number(row.water_level_mm),
    signal: row.signal == null ? null : Number(row.signal),
    batteryPct: row.battery_pct == null ? null : Number(row.battery_pct),
    raw: parseJson<Record<string, unknown> | null>(row.raw, null),
  };
}

export { parseJson };
