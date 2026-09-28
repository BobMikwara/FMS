import type { ScheduledReport } from "@/server/domain/types";
import { createScheduledReport, listScheduledReports } from "@/server/db/repo/reports";
import { listAllStations } from "@/server/db/repo/stations";
import { ApiError } from "@/server/api/route";
import {
  audit,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  num,
  parseJsonBody,
  required,
  str,
  withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const rows = (await listScheduledReports(ctx.user.organizationId, ctx.user.stationIds));
    return jsonOk({ rows, total: rows.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const name = maxLen(required(body.name, "Schedule name"), 120, "Schedule name");
    const period = str(body.period, "weekly") as "daily" | "weekly" | "monthly";
    // Accept either an explicit HH:MM string or a bare hour number.
    const explicitTime = str(body.timeOfDay);
    const parsedHour = /^([01]\d|2[0-3]):[0-5]\d$/.test(explicitTime)
      ? Number(explicitTime.slice(0, 2))
      : num(body.hour, 7);
    const hour = parsedHour;
    const requestedStationId = str(body.stationId) || null;
    if (requestedStationId) {
      const stations = await listAllStations(ctx.user.organizationId);
      if (!stations.some((station) => station.id === requestedStationId)) {
        throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
      }
      if (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(requestedStationId)) {
        throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
      }
    } else if (ctx.user.stationIds.length > 0) {
      throw new ApiError(403, "A station must be selected for a scoped scheduled report.", "forbidden");
    }
    let scheduled!: ScheduledReport;
    try {
      scheduled = (await createScheduledReport({
        organizationId: ctx.user.organizationId,
        name,
        category: str(body.category, "consumption"),
        period,
        dayOfWeek: num(body.dayOfWeek, 1),
        dayOfMonth: period === "monthly" ? num(body.dayOfMonth, 1) : null,
        timeOfDay: /^([01]\d|2[0-3]):[0-5]\d$/.test(explicitTime)
          ? explicitTime
          : `${String(Math.min(23, Math.max(0, hour))).padStart(2, "0")}:00`,
        timezone: str(body.timezone, "Africa/Dar_es_Salaam"),
        recipients: Array.isArray(body.recipients) ? (body.recipients as string[]) : [],
        format: str(body.format, "pdf"),
        stationId: requestedStationId,
        filters: (body.filters ?? {}) as Record<string, unknown>,
        isEnabled: body.isEnabled !== false,
      }));
    } catch (error) {
      uniqueViolation(error, "A schedule with this name", "name");
    }
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "scheduled_report",
      entityId: scheduled.id,
      entityLabel: scheduled.name,
      summary: `${ctx.user.name} scheduled report "${scheduled.name}" (${scheduled.period})`,
      next: scheduled,
      request,
    }));
    return jsonCreated(scheduled);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
