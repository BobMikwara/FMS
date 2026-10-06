import { hasOrganizationWideStationAccess, stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { audit, ApiError, jsonCreated, jsonError, jsonOk, parseJsonBody, withPermission } from "@/server/api/route";
import { createScheduledReport, listScheduledReports } from "@/server/db/repo/reports";
import { deliveryStatusCountsForRuns, latestScheduledReportRuns } from "@/server/db/repo/scheduled-runs";
import { getOrganization } from "@/server/db/repo/core";
import { getStation } from "@/server/db/repo/stations";
import { emailDeliveryConfigured } from "@/server/email/mailer";
import { nextScheduledAt } from "@/server/services/schedule";
import { validateScheduleDefinition } from "@/server/services/scheduled-report-policy";

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const schedules = await listScheduledReports(ctx.user.organizationId, stationScopeForUser(ctx.user));
    const runsBySchedule = await latestScheduledReportRuns(schedules.map((row) => row.id));
    const deliveryCounts = await deliveryStatusCountsForRuns(
      [...runsBySchedule.values()].map((run) => run.id),
    );
    const canSeeRecipients = hasPermission(ctx.user, "reports.schedule");
    const rows = schedules.map((row) => {
      const lastRun = runsBySchedule.get(row.id) ?? null;
      const deliveryStatus = lastRun ? deliveryCounts.get(lastRun.id) ?? {} : {};
      return {
        ...row,
        recipients: canSeeRecipients ? row.recipients : [],
        lastRunStatus: lastRun?.status ?? null,
        lastRunError: lastRun?.lastError ?? null,
        lastRunCompletedAt: lastRun?.completedAt ?? null,
        lastRunDeliveries: deliveryStatus,
      };
    });
    return jsonOk({
      rows,
      total: rows.length,
      executionAvailable: true,
      emailDeliveryConfigured: emailDeliveryConfigured(),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const validated = validateScheduleDefinition(body);
    if (!validated.ok) throw new ApiError(422, validated.message, "validation_error");
    const definition = validated.value;
    let timezone: string;
    if (definition.stationId) {
      const station = await getStation(definition.stationId);
      if (!station || station.organizationId !== ctx.user.organizationId || station.isArchived) {
        throw new ApiError(422, "The selected station is not an active station in this organization.", "validation_error");
      }
      if (!userCanAccessStation(ctx.user, station.id)) {
        throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
      }
      timezone = station.timezone;
    } else {
      if (!hasOrganizationWideStationAccess(ctx.user)) {
        throw new ApiError(403, "Select a station within your scope before creating a scheduled report.", "forbidden");
      }
      const organization = await getOrganization(ctx.user.organizationId);
      timezone = organization?.timezone ?? "Africa/Dar_es_Salaam";
    }

    const nextRunAt = definition.isEnabled
      ? nextScheduledAt({ ...definition, timezone })
      : null;
    const schedule = await createScheduledReport({
      organizationId: ctx.user.organizationId,
      ...definition,
      timezone,
      filters: { createdById: ctx.user.id },
      nextRunAt,
    });
    await audit({
      user: ctx.user,
      action: "created",
      entity: "scheduled_report",
      entityId: schedule.id,
      entityLabel: schedule.name,
      summary: `${ctx.user.name} created scheduled report "${schedule.name}"`,
      next: schedule,
      request,
    });
    return jsonCreated(schedule);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
