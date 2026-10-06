import { execute, id, isPostgres, query, queryOne, transaction, toIso } from "../client";
import type { ScheduledReportRun } from "../../domain/types";

export interface ClaimedScheduledReportRun extends ScheduledReportRun {}

export async function dueScheduledReportIds(now: string, limit = 50): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM scheduled_reports
     WHERE is_enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
     ORDER BY next_run_at ASC, created_at ASC LIMIT ?`,
    [now, Math.min(100, Math.max(1, Math.floor(limit)))],
  );
  return rows.map((row) => String(row.id));
}

export async function lockScheduledReport(scheduledReportId: string): Promise<void> {
  const lock = isPostgres() ? " FOR UPDATE" : "";
  await queryOne(`SELECT id FROM scheduled_reports WHERE id = ?${lock}`, [scheduledReportId]);
}

export async function createScheduledReportRun(input: {
  organizationId: string;
  scheduledReportId: string;
  scheduledFor: string;
}): Promise<ScheduledReportRun> {
  const runId = id("srr");
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO scheduled_report_runs (
       id, organization_id, scheduled_report_id, scheduled_for, status, attempt_count,
       next_attempt_at, started_at, completed_at, report_id, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
     ON CONFLICT (scheduled_report_id, scheduled_for) DO NOTHING`,
    [runId, input.organizationId, input.scheduledReportId, input.scheduledFor, now, now],
  );
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM scheduled_report_runs WHERE scheduled_report_id = ? AND scheduled_for = ?",
    [input.scheduledReportId, input.scheduledFor],
  );
  if (!row) throw new Error("Could not verify the scheduled report run");
  return mapRun(row);
}

export async function claimScheduledReportRuns(input: {
  limit?: number;
  now?: string;
  staleBefore?: string;
} = {}): Promise<ClaimedScheduledReportRun[]> {
  const now = input.now ?? new Date().toISOString();
  const staleBefore = input.staleBefore ?? new Date(Date.now() - 10 * 60_000).toISOString();
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? 10)));
  return transaction(async () => {
    await execute(
      `UPDATE scheduled_report_runs
       SET status = 'failed', next_attempt_at = NULL,
           last_error = COALESCE(last_error, 'Report worker stopped before completion'), updated_at = ?
       WHERE status = 'running' AND updated_at <= ? AND attempt_count >= 5`,
      [now, staleBefore],
    );
    const lock = isPostgres() ? " FOR UPDATE SKIP LOCKED" : "";
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM scheduled_report_runs
       WHERE attempt_count < 5 AND (
         (status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         OR (status = 'running' AND updated_at <= ?)
       )
       ORDER BY created_at ASC LIMIT ?${lock}`,
      [now, staleBefore, limit],
    );
    const claimed: ClaimedScheduledReportRun[] = [];
    for (const row of rows) {
      const runId = String(row.id);
      await execute(
        `UPDATE scheduled_report_runs
         SET status = 'running', attempt_count = attempt_count + 1,
             next_attempt_at = NULL, started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ?`,
        [now, now, runId],
      );
      const updated = await queryOne<Record<string, unknown>>(
        "SELECT * FROM scheduled_report_runs WHERE id = ?",
        [runId],
      );
      if (updated) claimed.push(mapRun(updated));
    }
    return claimed;
  });
}

export async function markScheduledReportRunReady(input: {
  runId: string;
  reportId: string;
  completedAt?: string;
}): Promise<void> {
  const completedAt = input.completedAt ?? new Date().toISOString();
  await execute(
    `UPDATE scheduled_report_runs
     SET status = 'ready', report_id = ?, completed_at = ?, next_attempt_at = NULL,
         last_error = NULL, updated_at = ? WHERE id = ? AND status = 'running'`,
    [input.reportId, completedAt, completedAt, input.runId],
  );
}

export async function markScheduledReportRunFailed(input: {
  runId: string;
  error: string;
  retryAt?: string | null;
}): Promise<void> {
  const run = await queryOne<{ attempt_count: number }>(
    "SELECT attempt_count FROM scheduled_report_runs WHERE id = ?",
    [input.runId],
  );
  if (!run) return;
  const retry = input.retryAt != null && Number(run.attempt_count) < 5;
  const now = new Date().toISOString();
  const error = input.error.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500) || "Scheduled report run failed";
  await execute(
    `UPDATE scheduled_report_runs
     SET status = ?, attempt_count = CASE WHEN ? = 1 THEN attempt_count ELSE 5 END,
         next_attempt_at = ?, last_error = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND status = 'running'`,
    [retry ? "queued" : "failed", retry ? 1 : 0, retry ? input.retryAt : null, error, retry ? null : now, now, input.runId],
  );
}

export async function getScheduledReportRun(runId: string): Promise<ScheduledReportRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM scheduled_report_runs WHERE id = ?",
    [runId],
  );
  return row ? mapRun(row) : null;
}

export async function latestScheduledReportRuns(scheduledReportIds: string[]): Promise<Map<string, ScheduledReportRun>> {
  if (scheduledReportIds.length === 0) return new Map();
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM (
       SELECT runs.*, ROW_NUMBER() OVER (
         PARTITION BY scheduled_report_id ORDER BY scheduled_for DESC, created_at DESC
       ) AS run_rank
       FROM scheduled_report_runs runs
       WHERE scheduled_report_id IN (${scheduledReportIds.map(() => "?").join(", ")})
     ) latest WHERE run_rank = 1`,
    scheduledReportIds,
  );
  return new Map(rows.map((row) => {
    const run = mapRun(row);
    return [run.scheduledReportId, run];
  }));
}

export async function deliveryStatusCountsForRuns(runIds: string[]): Promise<Map<string, Record<string, number>>> {
  if (runIds.length === 0) return new Map();
  const rows = await query<{ scheduled_report_run_id: string; status: string; count: number }>(
    `SELECT scheduled_report_run_id, status, count(*) AS count
     FROM notification_deliveries
     WHERE scheduled_report_run_id IN (${runIds.map(() => "?").join(", ")})
     GROUP BY scheduled_report_run_id, status`,
    runIds,
  );
  const result = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const counts = result.get(row.scheduled_report_run_id) ?? {};
    counts[row.status] = Number(row.count);
    result.set(row.scheduled_report_run_id, counts);
  }
  return result;
}

export async function listScheduledReportRuns(scheduledReportId: string, limit = 20): Promise<ScheduledReportRun[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM scheduled_report_runs WHERE scheduled_report_id = ?
     ORDER BY scheduled_for DESC, created_at DESC LIMIT ?`,
    [scheduledReportId, Math.min(100, Math.max(1, Math.floor(limit)))],
  );
  return rows.map(mapRun);
}

function mapRun(row: Record<string, unknown>): ScheduledReportRun {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    scheduledReportId: String(row.scheduled_report_id),
    scheduledFor: toIso(row.scheduled_for) ?? String(row.scheduled_for),
    status: String(row.status) as ScheduledReportRun["status"],
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: toIso(row.next_attempt_at),
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    reportId: row.report_id == null ? null : String(row.report_id),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: toIso(row.created_at) ?? String(row.created_at),
    updatedAt: toIso(row.updated_at) ?? String(row.updated_at),
  };
}
