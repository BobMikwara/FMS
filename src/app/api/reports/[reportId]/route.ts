import { deleteReport, getReport, updateReport } from "@/server/db/repo/reports";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const report = getReport(ctx.params?.reportId ?? "");
    if (!report || report.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    return jsonOk(report);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("reports.create", async (request, ctx) => {
  try {
    const reportId = ctx.params?.reportId ?? "";
    const existing = getReport(reportId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "category", "status", "filters"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const report = updateReport(reportId, patch);
    if (!report) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "report",
      entityId: report.id,
      entityLabel: report.title,
      summary: `${ctx.user.name} updated report "${report.title}"`,
      previous: existing,
      next: report,
      request,
    });
    return jsonOk(report);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("reports.create", async (request, ctx) => {
  try {
    const reportId = ctx.params?.reportId ?? "";
    const existing = getReport(reportId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    deleteReport(reportId);
    audit({
      user: ctx.user,
      action: "deleted",
      entity: "report",
      entityId: existing.id,
      entityLabel: existing.title,
      summary: `${ctx.user.name} deleted report "${existing.title}"`,
      previous: existing,
      request,
    });
    return jsonOk({ id: reportId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
