import { deleteScheduledReport, getScheduledReport, updateScheduledReport } from "@/server/db/repo/reports";
import { listAllStations } from "@/server/db/repo/stations";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, str, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const scheduledId = ctx.params?.scheduledId ?? "";
    const existing = (await getScheduledReport(scheduledId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && (!existing.stationId || !ctx.user.stationIds.includes(existing.stationId)))
    ) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of [
      "name",
      "category",
      "period",
      "dayOfWeek",
      "dayOfMonth",
      "timeOfDay",
      "timezone",
      "recipients",
      "format",
      "stationId",
      "filters",
      "isEnabled",
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.stationId !== undefined) {
      const stationId = str(body.stationId) || null;
      if (!stationId) return jsonError(notFound(), request);
      const station = (await listAllStations(ctx.user.organizationId)).find((entry) => entry.id === stationId);
      if (!station || (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(stationId))) {
        return jsonError(notFound(), request);
      }
      patch.stationId = stationId;
    }
    const scheduled = (await updateScheduledReport(scheduledId, patch));
    if (!scheduled) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "scheduled_report",
      entityId: scheduled.id,
      entityLabel: scheduled.name,
      summary: `${ctx.user.name} updated scheduled report "${scheduled.name}"`,
      previous: existing,
      next: scheduled,
      request,
    }));
    return jsonOk(scheduled);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const scheduledId = ctx.params?.scheduledId ?? "";
    const existing = (await getScheduledReport(scheduledId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && (!existing.stationId || !ctx.user.stationIds.includes(existing.stationId)))
    ) return jsonError(notFound(), request);
    (await deleteScheduledReport(scheduledId));
    (await audit({
      user: ctx.user,
      action: "deleted",
      entity: "scheduled_report",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} deleted scheduled report "${existing.name}"`,
      previous: existing,
      request,
    }));
    return jsonOk({ id: scheduledId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
