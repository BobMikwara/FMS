import { hasOrganizationWideStationAccess, stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/permissions";
import { getOrganization } from "@/server/db/repo/core";
import { disableScheduledReport, getScheduledReport, updateScheduledReport } from "@/server/db/repo/reports";
import { getStation } from "@/server/db/repo/stations";
import { ApiError, audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";
import { nextScheduledAt } from "@/server/services/schedule";
import { validateScheduleDefinition } from "@/server/services/scheduled-report-policy";

export const dynamic = "force-dynamic";

function canAccessScheduledReport(user: SessionUser, stationId: string | null): boolean {
  return stationId === null
    ? stationScopeForUser(user) === undefined
    : userCanAccessStation(user, stationId);
}

async function timezoneForSchedule(
  organizationId: string,
  stationId: string | null,
  user: SessionUser,
): Promise<string> {
  if (stationId) {
    const station = await getStation(stationId);
    if (!station || station.organizationId !== organizationId || station.isArchived) {
      throw new ApiError(422, "The selected station is not an active station in this organization.", "validation_error");
    }
    if (!userCanAccessStation(user, stationId)) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    return station.timezone;
  }
  if (!hasOrganizationWideStationAccess(user)) {
    throw new ApiError(403, "Select a station within your scope before saving this schedule.", "forbidden");
  }
  const organization = await getOrganization(organizationId);
  return organization?.timezone ?? "Africa/Dar_es_Salaam";
}

export const PATCH = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const scheduledId = ctx.params?.scheduledId ?? "";
    const existing = await getScheduledReport(scheduledId);
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !canAccessScheduledReport(ctx.user, existing.stationId)
    ) return jsonError(notFound(), request);

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const allowedKeys = new Set([
      "name", "category", "period", "dayOfWeek", "dayOfMonth", "timeOfDay", "format", "stationId", "recipients", "isEnabled",
    ]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      throw new ApiError(422, "The request contains unsupported schedule fields.", "validation_error");
    }
    if (Object.keys(body).length === 1 && body.isEnabled === false) {
      const schedule = await updateScheduledReport(scheduledId, { isEnabled: false });
      await audit({
        user: ctx.user,
        action: "updated",
        entity: "scheduled_report",
        entityId: scheduledId,
        entityLabel: existing.name,
        summary: `${ctx.user.name} paused scheduled report "${existing.name}"`,
        previous: existing,
        next: schedule,
        request,
      });
      return jsonOk(schedule);
    }

    const definitionInput = {
      name: body.name ?? existing.name,
      category: body.category ?? existing.category,
      period: body.period ?? existing.period,
      dayOfWeek: body.dayOfWeek !== undefined ? body.dayOfWeek : existing.dayOfWeek,
      dayOfMonth: body.dayOfMonth !== undefined ? body.dayOfMonth : existing.dayOfMonth,
      timeOfDay: body.timeOfDay ?? existing.timeOfDay,
      format: body.format ?? existing.format,
      stationId: body.stationId !== undefined ? body.stationId : existing.stationId,
      recipients: body.recipients ?? existing.recipients,
      isEnabled: body.isEnabled !== undefined ? body.isEnabled : existing.isEnabled,
    };
    const validated = validateScheduleDefinition(definitionInput);
    if (!validated.ok) throw new ApiError(422, validated.message, "validation_error");
    const definition = validated.value;
    const timezone = await timezoneForSchedule(ctx.user.organizationId, definition.stationId, ctx.user);
    const nextRunAt = definition.isEnabled
      ? nextScheduledAt({ ...definition, timezone })
      : null;
    const schedule = await updateScheduledReport(scheduledId, {
      ...definition,
      timezone,
      filters: {
        ...existing.filters,
        createdById: typeof existing.filters.createdById === "string" ? existing.filters.createdById : ctx.user.id,
      },
      nextRunAt,
    });
    if (!schedule) return jsonError(notFound(), request);
    await audit({
      user: ctx.user,
      action: "updated",
      entity: "scheduled_report",
      entityId: schedule.id,
      entityLabel: schedule.name,
      summary: `${ctx.user.name} updated scheduled report "${schedule.name}"${schedule.isEnabled ? "" : " (paused)"}`,
      previous: existing,
      next: schedule,
      request,
    });
    return jsonOk(schedule);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const scheduledId = ctx.params?.scheduledId ?? "";
    const existing = await getScheduledReport(scheduledId);
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !canAccessScheduledReport(ctx.user, existing.stationId)
    ) return jsonError(notFound(), request);

    const scheduled = await disableScheduledReport(scheduledId);
    await audit({
      user: ctx.user,
      action: "disabled",
      entity: "scheduled_report",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} paused scheduled report "${existing.name}"`,
      previous: existing,
      next: scheduled,
      request,
    });
    return jsonOk({ id: scheduledId, isEnabled: false, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
