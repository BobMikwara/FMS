import { execute, id, insertMany, intToBool, query, queryOne, toIso } from "../client";
import type {
  AuditLog,
  Integration,
  Notification,
  Organization,
  Role,
  SystemSetting,
  User,
} from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Organizations                                                              */
/* -------------------------------------------------------------------------- */

export async function listOrganizations(): Promise<Organization[]> {
  return (await query<Record<string, unknown>>("SELECT * FROM organizations ORDER BY name")).map(mapOrganization);
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM organizations WHERE id = ?", [orgId]);
  return row ? mapOrganization(row) : null;
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM organizations WHERE slug = ?", [slug]);
  return row ? mapOrganization(row) : null;
}

function mapOrganization(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    logoUrl: row.logo_url == null ? null : String(row.logo_url),
    currency: String(row.currency ?? "TZS"),
    units: String(row.units ?? "liters") as Organization["units"],
    tempUnit: String(row.temp_unit ?? "celsius") as Organization["tempUnit"],
    timezone: String(row.timezone ?? "Africa/Dar_es_Salaam"),
    locale: String(row.locale ?? "en"),
    plan: String(row.plan ?? "growth"),
    isActive: intToBool(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function updateOrganization(
  orgId: string,
  patch: Partial<Omit<Organization, "id" | "createdAt" | "updatedAt">>,
): Promise<Organization | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(snake(key));
    values.push((await serialize(key, value)));
  }
  if (fields.length === 0) return (await getOrganization(orgId));
  values.push(orgId);
  (await execute(`UPDATE organizations SET ${fields.map((f) => `${f} = ?`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getOrganization(orgId));
}

/* -------------------------------------------------------------------------- */
/* Roles & permissions                                                        */
/* -------------------------------------------------------------------------- */

export async function listRoles(): Promise<Role[]> {
  const rows = (await query<Record<string, unknown>>("SELECT * FROM roles ORDER BY name"));
  return rows.map(mapRole);
}

export async function getRole(roleId: string): Promise<Role | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM roles WHERE id = ?", [roleId]));
  return row ? (await mapRole(row)) : null;
}

export async function getRoleByKey(key: string): Promise<Role | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM roles WHERE key = ?", [key]));
  return row ? (await mapRole(row)) : null;
}

export async function updateRole(roleId: string, patch: { name?: string; description?: string; permissions?: string[] }): Promise<Role | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    fields.push("description = ?");
    values.push(patch.description);
  }
  if (patch.permissions !== undefined) {
    fields.push("permissions = ?");
    values.push(JSON.stringify(patch.permissions));
  }
  if (fields.length === 0) return (await getRole(roleId));
  values.push(roleId);
  (await execute(`UPDATE roles SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getRole(roleId));
}

function mapRole(row: Record<string, unknown>): Role {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description ?? ""),
    isSystem: intToBool(row.is_system),
    permissions: parseJson<string[]>(row.permissions, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export async function listUsers(orgId: string): Promise<User[]> {
  const rows = (await query<Record<string, unknown>>(
    `SELECT u.*, r.key AS role_key, r.name AS role_name, r.permissions AS role_permissions
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.organization_id = ? ORDER BY u.created_at DESC`,
    [orgId],
  ));
  const stationMap = (await userStationMap(rows.map((r) => String(r.id))));
  return rows.map((row) => mapUser(row, stationMap));
}

export async function getUser(userId: string): Promise<User | null> {
  const row = (await queryOne<Record<string, unknown>>(
    `SELECT u.*, r.key AS role_key, r.name AS role_name, r.permissions AS role_permissions
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [userId],
  ));
  return row ? (await mapUser(row, (await userStationMap([userId])))) : null;
}

export async function getUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const row = (await queryOne<Record<string, unknown>>(
    `SELECT u.*, r.key AS role_key, r.name AS role_name, r.permissions AS role_permissions
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
    [email.toLowerCase()],
  ));
  if (!row) return null;
  const user = (await mapUser(row, (await userStationMap([String(row.id)]))));
  return { ...user, passwordHash: String(row.password_hash) };
}

export async function countUsers(orgId: string): Promise<number> {
  const row = (await queryOne<{ n: number }>("SELECT count(*) AS n FROM users WHERE organization_id = ?", [orgId]));
  return Number(row?.n ?? 0);
}

export async function createUser(input: {
  organizationId: string;
  email: string;
  name: string;
  passwordHash: string;
  roleId: string;
  phone?: string | null;
  jobTitle?: string | null;
  status?: "active" | "invited" | "suspended";
  stationIds?: string[];
  mfaEnabled?: boolean;
}): Promise<User> {
  const userId = id("usr");
  (await execute(
    `INSERT INTO users (id, organization_id, email, name, password_hash, role_id, status, phone, job_title, mfa_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      userId,
      input.organizationId,
      input.email.toLowerCase(),
      input.name,
      input.passwordHash,
      input.roleId,
      input.status ?? "active",
      input.phone ?? null,
      input.jobTitle ?? null,
      input.mfaEnabled ? 1 : 0,
    ],
  ));
  (await setUserStations(userId, input.stationIds ?? []));
  return (await getUser(userId))!;
}

export async function updateUser(
  userId: string,
  patch: {
    name?: string;
    email?: string;
    roleId?: string;
    phone?: string | null;
    jobTitle?: string | null;
    status?: "active" | "invited" | "suspended";
    passwordHash?: string;
    mfaEnabled?: boolean;
    lastLoginAt?: string;
    lastLoginIp?: string;
    failedAttempts?: number;
    lockedUntil?: string | null;
  },
): Promise<User | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.email !== undefined) push("email", patch.email.toLowerCase());
  if (patch.roleId !== undefined) push("role_id", patch.roleId);
  if (patch.phone !== undefined) push("phone", patch.phone);
  if (patch.jobTitle !== undefined) push("job_title", patch.jobTitle);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.passwordHash !== undefined) push("password_hash", patch.passwordHash);
  if (patch.mfaEnabled !== undefined) push("mfa_enabled", patch.mfaEnabled ? 1 : 0);
  if (patch.lastLoginAt !== undefined) push("last_login_at", patch.lastLoginAt);
  if (patch.lastLoginIp !== undefined) push("last_login_ip", patch.lastLoginIp);
  if (patch.failedAttempts !== undefined) push("failed_attempts", patch.failedAttempts);
  if (patch.lockedUntil !== undefined) push("locked_until", patch.lockedUntil);
  if (fields.length === 0) return (await getUser(userId));
  values.push(userId);
  (await execute(`UPDATE users SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getUser(userId));
}

export async function deleteUser(userId: string): Promise<void> {
  (await execute("DELETE FROM users WHERE id = ?", [userId]));
}

export async function setUserStations(userId: string, stationIds: string[]): Promise<void> {
  (await execute("DELETE FROM user_stations WHERE user_id = ?", [userId]));
  for (const stationId of stationIds) {
    (await execute("INSERT INTO user_stations (user_id, station_id) VALUES (?, ?) ON CONFLICT DO NOTHING", [userId, stationId]));
  }
}

export async function userStationMap(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => "?").join(", ");
  const rows = (await query<{ user_id: string; station_id: string }>(
    `SELECT user_id, station_id FROM user_stations WHERE user_id IN (${placeholders})`,
    userIds,
  ));
  for (const row of rows) {
    const list = map.get(row.user_id) ?? [];
    list.push(row.station_id);
    map.set(row.user_id, list);
  }
  return map;
}

function mapUser(row: Record<string, unknown>, stationMap: Map<string, string[]>): User {
  const userId = String(row.id);
  return {
    id: userId,
    organizationId: String(row.organization_id),
    email: String(row.email),
    name: String(row.name),
    roleId: String(row.role_id),
    roleKey: String(row.role_key ?? ""),
    roleName: String(row.role_name ?? ""),
    permissions: parseJson<string[]>(row.role_permissions, []),
    status: String(row.status) as User["status"],
    phone: row.phone == null ? null : String(row.phone),
    jobTitle: row.job_title == null ? null : String(row.job_title),
    avatarUrl: row.avatar_url == null ? null : String(row.avatar_url),
    lastLoginAt: toIso(row.last_login_at),
    lastLoginIp: row.last_login_ip == null ? null : String(row.last_login_ip),
    mfaEnabled: intToBool(row.mfa_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    stationIds: stationMap.get(userId) ?? [],
  };
}

/* -------------------------------------------------------------------------- */
/* Password reset tokens                                                      */
/* -------------------------------------------------------------------------- */

export async function createResetToken(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
  (await execute(
    "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    [id("prt"), userId, tokenHash, expiresAt],
  ));
}

export async function consumeResetToken(tokenHash: string): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>(
    `UPDATE password_reset_tokens
     SET used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
     RETURNING user_id`,
    [tokenHash, new Date().toISOString()],
  );
  return row ? String(row.user_id) : null;
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export async function createAuditLog(input: {
  userId: string | null;
  userLabel: string;
  action: string;
  entity: string;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  previous?: unknown;
  next?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<AuditLog> {
  const auditId = id("aud");
  (await execute(
    `INSERT INTO audit_logs (id, ts, user_id, user_label, action, entity, entity_id, entity_label, summary, previous, next, ip, user_agent)
     VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditId,
      input.userId,
      input.userLabel,
      input.action,
      input.entity,
      input.entityId ?? null,
      input.entityLabel ?? null,
      input.summary,
      input.previous === undefined ? null : JSON.stringify(input.previous),
      input.next === undefined ? null : JSON.stringify(input.next),
      input.ip ?? null,
      input.userAgent ?? null,
    ],
  ));
  return (await getAuditLog(auditId))!;
}

export async function getAuditLog(auditId: string): Promise<AuditLog | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM audit_logs WHERE id = ?", [auditId]));
  return row ? mapAuditLog(row) : null;
}

export interface AuditFilter {
  orgId: string;
  userId?: string;
  userIds?: string[];
  entity?: string;
  action?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listAuditLogs(filter: AuditFilter): Promise<{ rows: AuditLog[]; total: number }> {
  const where: string[] = ["l.user_id IN (SELECT id FROM users WHERE organization_id = ?)"];
  const params: unknown[] = [filter.orgId];
  if (filter.userId) {
    where.push("l.user_id = ?");
    params.push(filter.userId);
  }
  if (filter.userIds) {
    if (filter.userIds.length === 0) return { rows: [], total: 0 };
    where.push(`l.user_id IN (${filter.userIds.map(() => "?").join(", ")})`);
    params.push(...filter.userIds);
  }
  if (filter.entity) {
    where.push("l.entity = ?");
    params.push(filter.entity);
  }
  if (filter.action) {
    where.push("l.action = ?");
    params.push(filter.action);
  }
  if (filter.search) {
    where.push("(l.summary LIKE ? OR l.entity_label LIKE ? OR l.user_label LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term, term);
  }
  if (filter.from) {
    where.push("l.ts >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("l.ts <= ?");
    params.push(filter.to);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(
    (await queryOne<{ n: number }>(`SELECT count(*) AS n FROM audit_logs l ${clause}`, params))?.n ?? 0,
  );
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(5, filter.pageSize ?? 25));
  const rows = (await query<Record<string, unknown>>(
    `SELECT l.* FROM audit_logs l ${clause} ORDER BY l.ts DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  ));
  return { rows: rows.map(mapAuditLog), total };
}

function mapAuditLog(row: Record<string, unknown>): AuditLog {
  return {
    id: String(row.id),
    ts: String(row.ts),
    userId: row.user_id == null ? null : String(row.user_id),
    userLabel: String(row.user_label ?? "System"),
    action: String(row.action),
    entity: String(row.entity),
    entityId: row.entity_id == null ? null : String(row.entity_id),
    entityLabel: row.entity_label == null ? null : String(row.entity_label),
    summary: String(row.summary),
    previous: parseJson<Record<string, unknown> | null>(row.previous, null),
    next: parseJson<Record<string, unknown> | null>(row.next, null),
    ip: row.ip == null ? null : String(row.ip),
    userAgent: row.user_agent == null ? null : String(row.user_agent),
  };
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export async function getSettings(orgId: string): Promise<Record<string, unknown>> {
  const rows = (await query<{ key: string; value: string }>(
    "SELECT key, value FROM system_settings WHERE organization_id = ?",
    [orgId],
  ));
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = parseJson(row.value, null);
  return out;
}

export async function getSetting(orgId: string, key: string, fallback: unknown = null): Promise<unknown> {
  const row = (await queryOne<{ value: string }>(
    "SELECT value FROM system_settings WHERE organization_id = ? AND key = ?",
    [orgId, key],
  ));
  return row ? parseJson(row.value, fallback) : fallback;
}

export async function setSetting(orgId: string, key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value === undefined ? null : value);
  (await execute(
    `INSERT INTO system_settings (id, organization_id, key, value, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(organization_id, key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    [id("set"), orgId, key, serialized],
  ));
}

export async function setSettings(orgId: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (const [key, value] of Object.entries(values)) (await setSetting(orgId, key, value));
  return (await getSettings(orgId));
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export async function createNotification(input: {
  organizationId: string;
  userId?: string | null;
  alertId?: string | null;
  title: string;
  body: string;
  severity?: string;
  channel?: string;
}): Promise<Notification> {
  const notificationId = id("ntf");
  (await execute(
    `INSERT INTO notifications (id, organization_id, user_id, alert_id, title, body, severity, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notificationId,
      input.organizationId,
      input.userId ?? null,
      input.alertId ?? null,
      input.title,
      input.body,
      input.severity ?? "info",
      input.channel ?? "in_app",
    ],
  ));
  return (await getNotification(notificationId))!;
}

export async function getNotification(notificationId: string): Promise<Notification | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM notifications WHERE id = ?", [notificationId]));
  return row ? mapNotification(row) : null;
}

export async function listNotifications(orgId: string, limit = 30, userId?: string): Promise<Notification[]> {
  const userClause = userId ? " AND (user_id IS NULL OR user_id = ?)" : "";
  const rows = (await query<Record<string, unknown>>(
    `SELECT * FROM notifications WHERE organization_id = ?${userClause} ORDER BY created_at DESC LIMIT ?`,
    userId ? [orgId, userId, limit] : [orgId, limit],
  ));
  return rows.map(mapNotification);
}

export async function countUnreadNotifications(orgId: string, userId?: string): Promise<number> {
  const userClause = userId ? " AND (user_id IS NULL OR user_id = ?)" : "";
  const row = (await queryOne<{ n: number }>(
    `SELECT count(*) AS n FROM notifications WHERE organization_id = ? AND is_read = 0${userClause}`,
    userId ? [orgId, userId] : [orgId],
  ));
  return Number(row?.n ?? 0);
}

export async function markNotificationsRead(orgId: string, ids?: string[], userId?: string): Promise<number> {
  const userClause = userId ? " AND (user_id IS NULL OR user_id = ?)" : "";
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const result = await execute(`UPDATE notifications SET is_read = 1 WHERE organization_id = ? AND id IN (${placeholders})${userClause}`, [
      orgId,
      ...ids,
      ...(userId ? [userId] : []),
    ]);
    return result.changes;
  }
  const result = await execute(`UPDATE notifications SET is_read = 1 WHERE organization_id = ?${userClause}`, [orgId, ...(userId ? [userId] : [])]);
  return result.changes;
}

function mapNotification(row: Record<string, unknown>): Notification {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: row.user_id == null ? null : String(row.user_id),
    alertId: row.alert_id == null ? null : String(row.alert_id),
    title: String(row.title),
    body: String(row.body),
    severity: String(row.severity) as Notification["severity"],
    channel: String(row.channel),
    isRead: intToBool(row.is_read),
    createdAt: String(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Integrations                                                               */
/* -------------------------------------------------------------------------- */

export async function listIntegrations(orgId: string): Promise<Integration[]> {
  const rows = (await query<Record<string, unknown>>(
    "SELECT * FROM integrations WHERE organization_id = ? ORDER BY kind, provider",
    [orgId],
  ));
  return rows.map(mapIntegration);
}

export async function getIntegration(integrationId: string): Promise<Integration | null> {
  const row = (await queryOne<Record<string, unknown>>("SELECT * FROM integrations WHERE id = ?", [integrationId]));
  return row ? mapIntegration(row) : null;
}

export async function upsertIntegration(input: {
  organizationId: string;
  kind: string;
  provider: string;
  name: string;
  status?: Integration["status"];
  config?: Record<string, unknown>;
  secretRef?: string | null;
  isEnabled?: boolean;
  lastSyncAt?: string | null;
  lastError?: string | null;
}): Promise<Integration> {
  const existing = (await queryOne<{ id: string }>(
    "SELECT id FROM integrations WHERE organization_id = ? AND kind = ? AND provider = ?",
    [input.organizationId, input.kind, input.provider],
  ));
  const integrationId = existing?.id ?? id("int");
  const configJson = JSON.stringify(input.config ?? {});
  (await execute(
    `INSERT INTO integrations (id, organization_id, kind, provider, name, status, config, secret_ref, is_enabled, last_sync_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(organization_id, kind, provider) DO UPDATE SET
       name = excluded.name,
       status = excluded.status,
       config = excluded.config,
       secret_ref = excluded.secret_ref,
       is_enabled = excluded.is_enabled,
       last_sync_at = excluded.last_sync_at,
       last_error = excluded.last_error,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    [
      integrationId,
      input.organizationId,
      input.kind,
      input.provider,
      input.name,
      input.status ?? "disconnected",
      configJson,
      input.secretRef ?? null,
      input.isEnabled ? 1 : 0,
      input.lastSyncAt ?? null,
      input.lastError ?? null,
    ],
  ));
  return (await getIntegration(integrationId))!;
}

export async function updateIntegration(
  integrationId: string,
  patch: Partial<{
    name: string;
    status: Integration["status"];
    config: Record<string, unknown>;
    secretRef: string | null;
    isEnabled: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
  }>,
): Promise<Integration | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (patch.config !== undefined) {
    fields.push("config = ?");
    values.push(JSON.stringify(patch.config));
  }
  if (patch.secretRef !== undefined) {
    fields.push("secret_ref = ?");
    values.push(patch.secretRef);
  }
  if (patch.isEnabled !== undefined) {
    fields.push("is_enabled = ?");
    values.push(patch.isEnabled ? 1 : 0);
  }
  if (patch.lastSyncAt !== undefined) {
    fields.push("last_sync_at = ?");
    values.push(patch.lastSyncAt);
  }
  if (patch.lastError !== undefined) {
    fields.push("last_error = ?");
    values.push(patch.lastError);
  }
  if (fields.length === 0) return (await getIntegration(integrationId));
  values.push(integrationId);
  (await execute(`UPDATE integrations SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values));
  return (await getIntegration(integrationId));
}

export async function deleteIntegration(integrationId: string): Promise<void> {
  (await execute("DELETE FROM integrations WHERE id = ?", [integrationId]));
}

function mapIntegration(row: Record<string, unknown>): Integration {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: String(row.kind),
    provider: String(row.provider),
    name: String(row.name),
    status: String(row.status) as Integration["status"],
    config: parseJson<Record<string, unknown>>(row.config, {}),
    secretRef: row.secret_ref == null ? null : String(row.secret_ref),
    lastSyncAt: toIso(row.last_sync_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    isEnabled: intToBool(row.is_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function serialize(key: string, value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (key === "permissions" && Array.isArray(value)) return JSON.stringify(value);
  return value;
}

export { insertMany, query, queryOne, execute };
