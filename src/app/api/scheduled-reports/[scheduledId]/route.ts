import { deleteScheduledReport, getScheduledReport, updateScheduledReport } from "@/server/db/repo/reports";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const scheduledId = ctx.params?.scheduledId ?? "";
    const existing = getScheduledReport(scheduledId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
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
    const scheduled = updateScheduledReport(scheduledId, patch);
    if (!scheduled) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "scheduled_report",
      entityId: scheduled.id,
      entityLabel: scheduled.name,
      summary: `${ctx.user.name} updated scheduled report "${scheduled.name}"`,
      previous: existing,
      next: scheduled,
      request,
    });
    return jsonOk(scheduled);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("reports.schedule", async (request, ctx) => {
  try {
    const scheduledId = ctx.params?.scheduledId ?? "";
    const existing = getScheduledReport(scheduledId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    deleteScheduledReport(scheduledId);
    audit({
      user: ctx.user,
      action: "deleted",
      entity: "scheduled_report",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} deleted scheduled report "${existing.name}"`,
      previous: existing,
      request,
    });
    return jsonOk({ id: scheduledId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
