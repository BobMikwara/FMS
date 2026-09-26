import { deleteReport, getReport, updateReport } from "@/server/db/repo/reports";
import { listAllStations } from "@/server/db/repo/stations";
import { reportStationIsAllowed } from "@/server/services/report-builder";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const report = (await getReport(ctx.params?.reportId ?? ""));
    if (!report || report.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(report, ctx.user.stationIds)) return jsonError(notFound(), request);
    return jsonOk(report);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("reports.create", async (request, ctx) => {
  try {
    const reportId = ctx.params?.reportId ?? "";
    const existing = (await getReport(reportId));
    if (!existing || existing.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(existing, ctx.user.stationIds)) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "category", "status", "filters"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const filters = patch.filters && typeof patch.filters === "object" && !Array.isArray(patch.filters)
      ? patch.filters as Record<string, unknown>
      : existing.filters;
    const stationId = typeof filters.stationId === "string" && filters.stationId.length > 0 ? filters.stationId : null;
    if (stationId) {
      const station = (await listAllStations(ctx.user.organizationId)).find((entry) => entry.id === stationId);
      if (!station) return jsonError(notFound(), request);
      if (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(stationId)) return jsonError(notFound(), request);
    }
    const report = (await updateReport(reportId, patch));
    if (!report) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "report",
      entityId: report.id,
      entityLabel: report.title,
      summary: `${ctx.user.name} updated report "${report.title}"`,
      previous: existing,
      next: report,
      request,
    }));
    return jsonOk(report);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("reports.create", async (request, ctx) => {
  try {
    const reportId = ctx.params?.reportId ?? "";
    const existing = (await getReport(reportId));
    if (!existing || existing.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(existing, ctx.user.stationIds)) return jsonError(notFound(), request);
    (await deleteReport(reportId));
    (await audit({
      user: ctx.user,
      action: "deleted",
      entity: "report",
      entityId: existing.id,
      entityLabel: existing.title,
      summary: `${ctx.user.name} deleted report "${existing.title}"`,
      previous: existing,
      request,
    }));
    return jsonOk({ id: reportId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
