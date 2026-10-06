import { transaction } from "../db/client";
import { createReport, getScheduledReport, updateScheduledReport } from "../db/repo/reports";
import { dueScheduledReportIds, lockScheduledReport, createScheduledReportRun, claimScheduledReportRuns, markScheduledReportRunFailed, markScheduledReportRunReady } from "../db/repo/scheduled-runs";
import { createNotificationDelivery } from "../db/repo/deliveries";
import { listUsers } from "../db/repo/core";
import { buildReportTable } from "./report-builder";
import { formatReportTable } from "./report-export";
import { dateFromDateTimeInputInTimeZone, datePartsInTimeZone, dayStartInTimeZone, normalizeTimeZone } from "./time-zone";
import { nextScheduledAt } from "./schedule";
import type { Report, ScheduledReport, User } from "../domain/types";
import { deliveryRetryDelayMs } from "./notification-delivery-worker";

const REPORT_EMAIL_MAX_BYTES = 2 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reportAuthor(users: User[], preferredId: unknown): User | null {
  const preferred = typeof preferredId === "string" ? users.find((user) => user.id === preferredId) : null;
  const eligible = (user: User) => user.status === "active" && (
    user.permissions.includes("*") || user.permissions.includes("reports.view") ||
    user.roleKey === "owner" || user.roleKey === "super_admin"
  );
  if (preferred && eligible(preferred)) return preferred;
  return users.find(eligible) ?? null;
}

function scheduledReportRange(schedule: ScheduledReport, scheduledFor: string): {
  from: string;
  to: string;
  label: string;
} {
  const timeZone = normalizeTimeZone(schedule.timezone);
  const reference = new Date(scheduledFor);
  const endExclusive = dayStartInTimeZone(reference, 0, timeZone);
  if (schedule.period === "daily" || schedule.period === "weekly") {
    const days = schedule.period === "daily" ? 1 : 7;
    const start = dayStartInTimeZone(reference, -days, timeZone);
    return {
      from: start.toISOString(),
      to: new Date(endExclusive.getTime() - 1).toISOString(),
      label: schedule.period === "daily" ? "previous day" : "previous seven days",
    };
  }

  const local = datePartsInTimeZone(reference, timeZone);
  const currentMonth = `${local.year}-${String(local.month).padStart(2, "0")}-01T00:00`;
  const currentMonthStart = dateFromDateTimeInputInTimeZone(currentMonth, timeZone);
  const previousMonthDate = new Date(Date.UTC(local.year, local.month - 2, 1));
  const previousMonth = `${previousMonthDate.getUTCFullYear()}-${String(previousMonthDate.getUTCMonth() + 1).padStart(2, "0")}-01T00:00`;
  const previousMonthStart = dateFromDateTimeInputInTimeZone(previousMonth, timeZone);
  if (!currentMonthStart || !previousMonthStart) throw new Error("Could not resolve the monthly report date range in its time zone.");
  return {
    from: previousMonthStart.toISOString(),
    to: new Date(currentMonthStart.getTime() - 1).toISOString(),
    label: "previous month",
  };
}

async function enqueueDueScheduleRuns(now: Date, limit = 50): Promise<{ queued: number; initialized: number }> {
  const ids = await dueScheduledReportIds(now.toISOString(), limit);
  let queued = 0;
  let initialized = 0;
  for (const scheduledReportId of ids) {
    const result = await transaction(async () => {
      await lockScheduledReport(scheduledReportId);
      const schedule = await getScheduledReport(scheduledReportId);
      if (!schedule || !schedule.isEnabled) return "ignored" as const;
      if (!schedule.nextRunAt) {
        await updateScheduledReport(schedule.id, { nextRunAt: nextScheduledAt(schedule, now) });
        return "initialized" as const;
      }
      const dueAt = Date.parse(schedule.nextRunAt);
      if (!Number.isFinite(dueAt) || dueAt > now.getTime()) return "ignored" as const;
      await createScheduledReportRun({
        organizationId: schedule.organizationId,
        scheduledReportId: schedule.id,
        scheduledFor: new Date(dueAt).toISOString(),
      });
      await updateScheduledReport(schedule.id, { nextRunAt: nextScheduledAt(schedule, now) });
      return "queued" as const;
    });
    if (result === "queued") queued += 1;
    if (result === "initialized") initialized += 1;
  }
  return { queued, initialized };
}

async function runScheduledReport(run: Awaited<ReturnType<typeof claimScheduledReportRuns>>[number]): Promise<"ready" | "retrying" | "failed"> {
  try {
    const schedule = await getScheduledReport(run.scheduledReportId);
    if (!schedule || schedule.organizationId !== run.organizationId) {
      throw new Error("The saved report schedule no longer exists.");
    }
    if (!schedule.isEnabled) throw new Error("The saved report schedule was paused before this run started.");

    const users = await listUsers(schedule.organizationId);
    const authorId = schedule.filters.createdById;
    const author = reportAuthor(users, authorId);
    if (!author) throw new Error("No active report author with report-view permission is available in this organization.");

    const range = scheduledReportRange(schedule, run.scheduledFor);
    const timeZone = normalizeTimeZone(schedule.timezone);
    const title = `${schedule.name} · ${range.label}`;
    const filters = {
      ...schedule.filters,
      stationId: schedule.stationId,
      timeZone,
      scheduledReportId: schedule.id,
      scheduledReportRunId: run.id,
    };
    const preview: Report = {
      id: `scheduled-${run.id}`,
      organizationId: schedule.organizationId,
      createdById: author.id,
      title,
      category: schedule.category,
      period: range.label,
      dateFrom: range.from,
      dateTo: range.to,
      filters,
      status: "ready",
      progress: 100,
      format: schedule.format as Report["format"],
      fileUrl: null,
      summary: null,
      error: null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
    const table = await buildReportTable(preview);

    const recipients = [...new Set(schedule.recipients.map((email) => email.trim().toLowerCase()).filter((email) => EMAIL_PATTERN.test(email)))];
    const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

    await transaction(async () => {
      const current = await getScheduledReport(schedule.id);
      if (!current || !current.isEnabled) throw new Error("The saved report schedule was paused before delivery was queued.");
      const report = await createReport({
        organizationId: schedule.organizationId,
        createdById: author.id,
        title,
        category: schedule.category,
        period: range.label,
        dateFrom: range.from,
        dateTo: range.to,
        filters,
        status: "ready",
        progress: 100,
        format: schedule.format as Report["format"],
        summary: {
          rowCount: table.rows.length,
          timeZone,
          scheduledReportId: schedule.id,
          scheduledReportRunId: run.id,
        },
      });
      const file = formatReportTable(report, table, timeZone, schedule.format);
      if (Buffer.byteLength(file.content, "utf8") > REPORT_EMAIL_MAX_BYTES) {
        throw new Error("The generated scheduled-report attachment exceeds the 2 MiB delivery limit.");
      }

      for (const recipient of recipients) {
        const recipientUser = userByEmail.get(recipient);
        await createNotificationDelivery({
          organizationId: schedule.organizationId,
          scheduledReportRunId: run.id,
          userId: recipientUser?.id ?? null,
          channel: "email",
          recipient,
          idempotencyKey: `scheduled-report:${run.id}:email:${recipient}`,
          payload: {
            subject: `Scheduled report: ${schedule.name}`,
            text: `${schedule.name}\n${range.label} · ${range.from} to ${range.to} (${timeZone})\n\nThe requested report is attached.`,
            filename: file.filename,
            contentType: file.contentType,
            content: file.content,
          },
        });
      }
      const completedAt = new Date().toISOString();
      await markScheduledReportRunReady({ runId: run.id, reportId: report.id, completedAt });
      await updateScheduledReport(schedule.id, { lastRunAt: completedAt });
    });
    return "ready";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled report generation failed";
    const permanent = /no active report author|paused before|does not exist|exceeds the 2 MiB|could not resolve/i.test(message);
    const canRetry = !permanent && run.attemptCount < 5;
    const retryAt = canRetry
      ? new Date(Date.now() + deliveryRetryDelayMs(run.attemptCount)).toISOString()
      : null;
    await markScheduledReportRunFailed({ runId: run.id, error: message, retryAt });
    await updateScheduledReport(run.scheduledReportId, { lastRunAt: new Date().toISOString() }).catch(() => null);
    return canRetry ? "retrying" : "failed";
  }
}

export async function processScheduledReports(input: { limit?: number; now?: Date } = {}): Promise<{
  schedulesQueued: number;
  schedulesInitialized: number;
  runsClaimed: number;
  runsReady: number;
  runsRetrying: number;
  runsFailed: number;
}> {
  const now = input.now ?? new Date();
  const due = await enqueueDueScheduleRuns(now);
  const runs = await claimScheduledReportRuns({ limit: input.limit ?? 8, now: now.toISOString() });
  const summary = {
    schedulesQueued: due.queued,
    schedulesInitialized: due.initialized,
    runsClaimed: runs.length,
    runsReady: 0,
    runsRetrying: 0,
    runsFailed: 0,
  };
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(2, runs.length) }, async () => {
    while (nextIndex < runs.length) {
      const run = runs[nextIndex++];
      const result = await runScheduledReport(run);
      if (result === "ready") summary.runsReady += 1;
      else if (result === "retrying") summary.runsRetrying += 1;
      else summary.runsFailed += 1;
    }
  });
  await Promise.all(workers);
  return summary;
}
