import { execute, id, intToBool, query, queryOne, toIso } from "../client";
import { parseJson, snake } from "./core";
import type { Report, ScheduledReport } from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

export interface ReportFilter {
  orgId: string;
  category?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listReports(filter: ReportFilter): { rows: Report[]; total: number } {
  const where: string[] = ["r.organization_id = ?"];
  const params: unknown[] = [filter.orgId];
  if (filter.category) {
    where.push("r.category = ?");
    params.push(filter.category);
  }
  if (filter.status) {
    where.push("r.status = ?");
    params.push(filter.status);
  }
  if (filter.search) {
    where.push("r.title LIKE ?");
    params.push(`%${filter.search}%`);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const total = Number(queryOne<{ n: number }>(`SELECT count(*) AS n FROM reports r ${clause}`, params)?.n ?? 0);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filter.pageSize ?? 20));
  const rows = query<Record<string, unknown>>(
    `SELECT r.*, u.name AS created_by_name FROM reports r JOIN users u ON u.id = r.created_by_id
     ${clause} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows: rows.map(mapReport), total };
}

export function getReport(reportId: string): Report | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM reports WHERE id = ?", [reportId]);
  return row ? mapReport(row) : null;
}

export function getReportWithAuthor(reportId: string): (Report & { createdByName: string }) | null {
  const row = queryOne<Record<string, unknown>>(
    `SELECT r.*, u.name AS created_by_name FROM reports r JOIN users u ON u.id = r.created_by_id WHERE r.id = ?`,
    [reportId],
  );
  return row ? { ...mapReport(row), createdByName: String(row.created_by_name) } : null;
}

export function createReport(input: {
  organizationId: string;
  createdById: string;
  title: string;
  category: string;
  period: string;
  dateFrom: string;
  dateTo: string;
  filters?: Record<string, unknown>;
  status?: Report["status"];
  progress?: number;
  format?: Report["format"];
  summary?: Record<string, unknown> | null;
  error?: string | null;
}): Report {
  const reportId = id("rpt");
  execute(
    `INSERT INTO reports (id, organization_id, created_by_id, title, category, period, date_from, date_to,
       filters, status, progress, format, summary, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      reportId,
      input.organizationId,
      input.createdById,
      input.title,
      input.category,
      input.period,
      input.dateFrom,
      input.dateTo,
      JSON.stringify(input.filters ?? {}),
      input.status ?? "ready",
      input.progress ?? 100,
      input.format ?? "pdf",
      input.summary ? JSON.stringify(input.summary) : null,
      input.error ?? null,
    ],
  );
  return getReport(reportId)!;
}

export function updateReport(reportId: string, patch: Record<string, unknown>): Report | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getReport(reportId);
  values.push(reportId);
  execute(`UPDATE reports SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getReport(reportId);
}

export function deleteReport(reportId: string): void {
  execute("DELETE FROM reports WHERE id = ?", [reportId]);
}

export function countReports(orgId: string): number {
  return Number(queryOne<{ n: number }>("SELECT count(*) AS n FROM reports WHERE organization_id = ?", [orgId])?.n ?? 0);
}

function mapReport(row: Record<string, unknown>): Report {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    createdById: String(row.created_by_id),
    title: String(row.title),
    category: String(row.category),
    period: String(row.period),
    dateFrom: String(row.date_from),
    dateTo: String(row.date_to),
    filters: parseJson<Record<string, unknown>>(row.filters, {}),
    status: String(row.status ?? "ready") as Report["status"],
    progress: Number(row.progress ?? 100),
    format: String(row.format ?? "pdf") as Report["format"],
    fileUrl: row.file_url == null ? null : String(row.file_url),
    summary: parseJson<Record<string, unknown> | null>(row.summary, null),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduled reports                                                          */
/* -------------------------------------------------------------------------- */

export function listScheduledReports(orgId: string): ScheduledReport[] {
  return query<Record<string, unknown>>(
    "SELECT * FROM scheduled_reports WHERE organization_id = ? ORDER BY is_enabled DESC, name",
    [orgId],
  ).map(mapScheduled);
}

export function getScheduledReport(scheduledId: string): ScheduledReport | null {
  const row = queryOne<Record<string, unknown>>("SELECT * FROM scheduled_reports WHERE id = ?", [scheduledId]);
  return row ? mapScheduled(row) : null;
}

export function createScheduledReport(input: {
  organizationId: string;
  name: string;
  category: string;
  period: ScheduledReport["period"];
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  timeOfDay?: string;
  timezone?: string;
  recipients: string[];
  format?: string;
  stationId?: string | null;
  filters?: Record<string, unknown>;
  isEnabled?: boolean;
  nextRunAt?: string | null;
}): ScheduledReport {
  const scheduledId = id("sch");
  execute(
    `INSERT INTO scheduled_reports (id, organization_id, name, category, period, day_of_week, day_of_month,
       time_of_day, timezone, recipients, format, station_id, filters, is_enabled, last_run_at, next_run_at,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
    [
      scheduledId,
      input.organizationId,
      input.name,
      input.category,
      input.period,
      input.dayOfWeek ?? null,
      input.dayOfMonth ?? null,
      input.timeOfDay ?? "18:00",
      input.timezone ?? "Africa/Dar_es_Salaam",
      JSON.stringify(input.recipients),
      input.format ?? "pdf",
      input.stationId ?? null,
      JSON.stringify(input.filters ?? {}),
      input.isEnabled === false ? 0 : 1,
      input.nextRunAt ?? null,
    ],
  );
  return getScheduledReport(scheduledId)!;
}

export function updateScheduledReport(scheduledId: string, patch: Record<string, unknown>): ScheduledReport | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${snake(key)} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (fields.length === 0) return getScheduledReport(scheduledId);
  values.push(scheduledId);
  execute(`UPDATE scheduled_reports SET ${fields.join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, values);
  return getScheduledReport(scheduledId);
}

export function deleteScheduledReport(scheduledId: string): void {
  execute("DELETE FROM scheduled_reports WHERE id = ?", [scheduledId]);
}

function mapScheduled(row: Record<string, unknown>): ScheduledReport {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    category: String(row.category),
    period: String(row.period) as ScheduledReport["period"],
    dayOfWeek: row.day_of_week == null ? null : Number(row.day_of_week),
    dayOfMonth: row.day_of_month == null ? null : Number(row.day_of_month),
    timeOfDay: String(row.time_of_day ?? "18:00"),
    timezone: String(row.timezone ?? "Africa/Dar_es_Salaam"),
    recipients: parseJson<string[]>(row.recipients, []),
    format: String(row.format ?? "pdf"),
    stationId: row.station_id == null ? null : String(row.station_id),
    filters: parseJson<Record<string, unknown>>(row.filters, {}),
    isEnabled: intToBool(row.is_enabled),
    lastRunAt: toIso(row.last_run_at),
    nextRunAt: toIso(row.next_run_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export { parseJson };
