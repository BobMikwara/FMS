import { execute, id, intToBool, query, queryOne } from "../client";
import { parseJson, snake } from "./core";
import type { Alert, AlertNote, AlertRule } from "../../domain/types";

export interface AlertFilter {
  orgId: string;
  stationId?: string;
  tankId?: string;
  deviceId?: string;
  type?: string;
  types?: string[];
  severity?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: "asc" | "desc";
  stationIds?: string[];
}

export async function listAlerts(filter: AlertFilter): Promise<{ rows: Alert[]; total: number }> {
  const where: string[] = ["a.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.stationIds !== undefined) {
    if (filter.stationIds.length === 0) where.push("1 = 0");
    else {
      where.push(`a.station_id IN (${filter.stationIds.map(() => "?").join(", ")})`);
      params.push(...filter.stationIds);
    }
  }
  if (filter.stationId) {
    where.push("a.station_id = ?");
    params.push(filter.stationId);
  }
  if (filter.tankId) {
    where.push("a.tank_id = ?");
    params.push(filter.tankId);
  }
  if (filter.deviceId) {
    where.push("a.device_id = ?");
    params.push(filter.deviceId);
  }
  if (filter.type) {
    where.push("a.type = ?");
    params.push(filter.type);
  }
  if (filter.types && filter.types.length > 0) {
    where.push(`a.type IN (${filter.types.map(() => "?").join(", ")})`);
    params.push(...filter.types);
  }
  if (filter.severity) {
    where.push("a.severity = ?");
    params.push(filter.severity);
  }
  if (filter.status) {
    where.push("a.status = ?");
    params.push(filter.status);
  }
  if (filter.from) {
    where.push("a.created_at >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("a.created_at <= ?");
    params.push(filter.to);
  }
  if (filter.search) {
    where.push("(a.title LIKE ? OR a.message LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term);
  }
  const clause = `WHERE ${where.join(" AND ")}`;

  const sortMap: Record<string, string> = {
    created_at: "a.created_at",
    severity: "a.severity",
    status: "a.status",
    type: "a.type",
  };
  const sortColumn = sortMap[filter.sort ?? "created_at"] ?? "a.created_at";
  const direction = filter.order === "desc" ? "DESC" : "ASC";

  const total = Number((await queryOne<{ n: number }>(`SELECT count(*) AS n FROM alerts a ${clause}`, params))?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 25));
  const rows = (await query<Record<string, unknown>>(
    `SELECT a.* FROM alerts a ${clause} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ));
  return { rows: rows.map(mapAlert), total };
}

export async function getAlert(alertId: string): Promise<Alert | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM alerts WHERE id = ?", [alertId]));
  return row ? mapAlert(row) : null;
}

export async function recentAlerts(orgId: string, limit = 8): Promise<Alert[]> {
  return (await query<Record<string, unknown>>(
    "SELECT * FROM alerts WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?",
    [orgId, limit],
  )).map(mapAlert);
}

export async function latestAlertForRule(ruleId: string, tankId?: string, deviceId?: string): Promise<Alert | null> {
  const where = ["rule_id = ?"];
  const params: unknown[] = [ruleId];
  if (tankId) {
    where.push("tank_id = ?");
    params.push(tankId);
  }
  if (deviceId) {
    where.push("device_id = ?");
    params.push(deviceId);
  }
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM alerts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
    params,
  );
  return row ? mapAlert(row) : null;
}

export async function activeAlertsForTank(tankId: string, type?: string): Promise<Alert[]> {
  const rows = type
    ? (await query<Record<string, unknown>>(
        "SELECT * FROM alerts WHERE tank_id = ? AND type = ? AND status != 'resolved' ORDER BY created_at DESC",
        [tankId, type],
      ))
    : (await query<Record<string, unknown>>(
        "SELECT * FROM alerts WHERE tank_id = ? AND status != 'resolved' ORDER BY created_at DESC",
        [tankId],
      ));
  return rows.map(mapAlert);
}

export async function activeAlertsForStation(stationId: string): Promise<Alert[]> {
  return (await query<Record<string, unknown>>(
    "SELECT * FROM alerts WHERE station_id = ? AND status != 'resolved' ORDER BY created_at DESC",
    [stationId],
  )).map(mapAlert);
}

export async function createAlert(input: {
  organizationId: string;
  stationId: string;
  tankId?: string | null;
  deviceId?: string | null;
  fuelEventId?: string | null;
  ruleId?: string | null;
  type: string;
  severity: Alert["severity"];
  title: string;
  message: string;
  value?: number | null;
  unit?: string | null;
  threshold?: number | null;
  metadata?: Record<string, unknown> | null;
}): Promise<Alert> {
  const alertId = id("alr");
  (await execute(
    `INSERT INTO alerts (id, organization_id, station_id, tank_id, device_id, fuel_event_id, rule_id,
       type, severity, title, message, value, unit, threshold, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      alertId,
      input.organizationId,
      input.stationId,
      input.tankId ?? null,
      input.deviceId ?? null,
      input.fuelEventId ?? null,
      input.ruleId ?? null,
      input.type,
      input.severity,
      input.title,
      input.message,
      input.value ?? null,
      input.unit ?? null,
      input.threshold ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  ));
  return (await getAlert(alertId))!;
}

export async function updateAlert(alertId: string, patch: Record<string, unknown>): Promise<Alert | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return (await getAlert(alertId));
  values.push(alertId);
  (await execute(`UPDATE alerts SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getAlert(alertId));
}

export async function acknowledgeAlert(alertId: string, userId: string): Promise<Alert | null> {
  return (await updateAlert(alertId, {
    status: "acknowledged",
    acknowledgedAt: new Date().toISOString(),
    acknowledgedById: userId,
  }));
}

export async function resolveAlert(alertId: string, userId: string, note?: string): Promise<Alert | null> {
  return (await updateAlert(alertId, {
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolvedById: userId,
    resolutionNote: note ?? null,
  }));
}

export async function reopenAlert(alertId: string): Promise<Alert | null> {
  return (await updateAlert(alertId, { status: "active", resolvedAt: null, resolvedById: null, resolutionNote: null }));
}


/* -------------------------------------------------------------------------- */
/* Alert notes                                                                */
/* -------------------------------------------------------------------------- */

export async function listAlertNotes(alertId: string): Promise<(AlertNote & { userName: string })[]> {
  return (await query<Record<string, unknown>>(
    `SELECT n.*, u.name AS user_name FROM alert_notes n JOIN users u ON u.id = n.user_id
     WHERE n.alert_id = ? ORDER BY n.created_at ASC`,
    [alertId],
  )).map((row) => ({
    id: String(row.id),
    alertId: String(row.alert_id),
    userId: String(row.user_id),
    body: String(row.body),
    createdAt: String(row.created_at),
    userName: String(row.user_name),
  }));
}

export async function addAlertNote(alertId: string, userId: string, body: string): Promise<void> {
  (await execute("INSERT INTO alert_notes (id, alert_id, user_id, body) VALUES (?, ?, ?, ?)", [
    id("anote"),
    alertId,
    userId,
    body,
  ]));
}

/* -------------------------------------------------------------------------- */
/* Alert rules                                                                */
/* -------------------------------------------------------------------------- */

export async function listAlertRules(orgId: string, stationIds?: string[]): Promise<AlertRule[]> {
  if (stationIds !== undefined && stationIds.length === 0) return [];
  const stationCte = stationIds === undefined
    ? ""
    : `WITH station_scope AS (SELECT id FROM stations WHERE organization_id = ? AND id IN (${stationIds.map(() => "?").join(", ")}))`;
  const stationParams = stationIds === undefined ? [] : [orgId, ...stationIds];
  const stationClause = stationIds === undefined
    ? ""
    : ` AND ar.scope <> 'organization'
      AND (
        (ar.station_id IS NOT NULL OR ar.tank_id IS NOT NULL OR ar.device_id IS NOT NULL)
        AND (ar.station_id IS NULL OR ar.station_id IN (SELECT id FROM station_scope))
        AND (ar.tank_id IS NULL OR ar.tank_id IN (
          SELECT t.id FROM tanks t WHERE t.organization_id = ar.organization_id AND t.station_id IN (SELECT id FROM station_scope)
        ))
        AND (ar.device_id IS NULL OR ar.device_id IN (
          SELECT d.id FROM devices d WHERE d.organization_id = ar.organization_id
            AND (d.station_id IS NULL OR d.station_id IN (SELECT id FROM station_scope))
            AND (d.tank_id IS NULL OR d.tank_id IN (
              SELECT t.id FROM tanks t WHERE t.organization_id = d.organization_id AND t.station_id IN (SELECT id FROM station_scope)
            ))
            AND (d.vehicle_id IS NULL OR d.vehicle_id IN (
              SELECT v.id FROM vehicles v WHERE v.organization_id = d.organization_id AND v.station_id IN (SELECT id FROM station_scope)
            ))
            AND (
              d.station_id IN (SELECT id FROM station_scope)
              OR d.tank_id IN (SELECT t.id FROM tanks t WHERE t.organization_id = d.organization_id AND t.station_id IN (SELECT id FROM station_scope))
              OR d.vehicle_id IN (SELECT v.id FROM vehicles v WHERE v.organization_id = d.organization_id AND v.station_id IN (SELECT id FROM station_scope))
            )
        ))
      )`;
  return (await query<Record<string, unknown>>(
    `${stationCte} SELECT ar.* FROM alert_rules ar WHERE ar.organization_id = ?${stationClause} ORDER BY ar.is_enabled DESC, ar.name`,
    [...stationParams, orgId],
  )).map(mapRule);
}

export async function getAlertRule(ruleId: string): Promise<AlertRule | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM alert_rules WHERE id = ?", [ruleId]));
  return row ? mapRule(row) : null;
}

export async function listEnabledRules(orgId: string): Promise<AlertRule[]> {
  return (await query<Record<string, unknown>>(
    "SELECT * FROM alert_rules WHERE organization_id = ? AND is_enabled = 1",
    [orgId],
  )).map(mapRule);
}

export async function createAlertRule(input: {
  organizationId: string;
  name: string;
  description?: string | null;
  type: string;
  scope?: AlertRule["scope"];
  tankId?: string | null;
  stationId?: string | null;
  deviceId?: string | null;
  fuelTypeId?: string | null;
  condition: Record<string, unknown>;
  severity: AlertRule["severity"];
  channels?: string[];
  isEnabled?: boolean;
  cooldownMin?: number;
}): Promise<AlertRule> {
  const ruleId = id("rul");
  (await execute(
    `INSERT INTO alert_rules (id, organization_id, name, description, type, scope, tank_id, station_id,
       device_id, fuel_type_id, condition, severity, channels, is_enabled, cooldown_min, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      ruleId,
      input.organizationId,
      input.name,
      input.description ?? null,
      input.type,
      input.scope ?? "tank",
      input.tankId ?? null,
      input.stationId ?? null,
      input.deviceId ?? null,
      input.fuelTypeId ?? null,
      JSON.stringify(input.condition),
      input.severity,
      JSON.stringify(input.channels ?? ["in_app", "email"]),
      input.isEnabled === false ? 0 : 1,
      input.cooldownMin ?? 30,
    ],
  ));
  return (await getAlertRule(ruleId))!;
}

export async function updateAlertRule(ruleId: string, patch: Record<string, unknown>): Promise<AlertRule | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(
      typeof value === "boolean"
        ? (value ? 1 : 0)
        : key === "condition" || key === "channels"
          ? JSON.stringify(value)
          : value,
    );
  }
  if (fields.length === 0) return (await getAlertRule(ruleId));
  values.push(ruleId);
  (await execute(`UPDATE alert_rules SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getAlertRule(ruleId));
}

export async function disableAlertRule(ruleId: string): Promise<AlertRule | null> {
  return (await updateAlertRule(ruleId, { isEnabled: false }));
}

function mapRule(row: Record<string, unknown>): AlertRule {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    type: String(row.type),
    scope: String(row.scope ?? "tank") as AlertRule["scope"],
    tankId: row.tank_id == null ? null : String(row.tank_id),
    stationId: row.station_id == null ? null : String(row.station_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    fuelTypeId: row.fuel_type_id == null ? null : String(row.fuel_type_id),
    condition: parseJson<Record<string, unknown>>(row.condition, {}),
    severity: String(row.severity ?? "warning") as AlertRule["severity"],
    channels: parseJson<string[]>(row.channels, ["in_app"]),
    isEnabled: intToBool(row.is_enabled),
    cooldownMin: Number(row.cooldown_min ?? 30),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAlert(row: Record<string, unknown>): Alert {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    organizationId: String(row.organization_id),
    stationId: String(row.station_id),
    tankId: row.tank_id == null ? null : String(row.tank_id),
    deviceId: row.device_id == null ? null : String(row.device_id),
    fuelEventId: row.fuel_event_id == null ? null : String(row.fuel_event_id),
    ruleId: row.rule_id == null ? null : String(row.rule_id),
    type: String(row.type),
    severity: String(row.severity ?? "warning") as Alert["severity"],
    title: String(row.title),
    message: String(row.message),
    value: row.value == null ? null : Number(row.value),
    unit: row.unit == null ? null : String(row.unit),
    threshold: row.threshold == null ? null : Number(row.threshold),
    status: String(row.status ?? "active") as Alert["status"],
    metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
    acknowledgedAt: row.acknowledged_at == null ? null : String(row.acknowledged_at),
    acknowledgedById: row.acknowledged_by_id == null ? null : String(row.acknowledged_by_id),
    resolvedAt: row.resolved_at == null ? null : String(row.resolved_at),
    resolvedById: row.resolved_by_id == null ? null : String(row.resolved_by_id),
    assignedToId: row.assigned_to_id == null ? null : String(row.assigned_to_id),
    resolutionNote: row.resolution_note == null ? null : String(row.resolution_note),
  };
}

export { parseJson };
