import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { archiveReport, getReport, updateReport } from "@/server/db/repo/reports";
import { listAllStations } from "@/server/db/repo/stations";
import { reportStationIsAllowed } from "@/server/services/report-builder";
import { ApiError, audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const report = (await getReport(ctx.params?.reportId ?? ""));
    if (!report || report.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(report, stationScopeForUser(ctx.user))) return jsonError(notFound(), request);
    return jsonOk(hasPermission(ctx.user, "reports.export") ? report : { ...report, fileUrl: null });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("reports.create", async (request, ctx) => {
  try {
    const reportId = ctx.params?.reportId ?? "";
    const existing = (await getReport(reportId));
    if (!existing || existing.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(existing, stationScopeForUser(ctx.user))) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "category", "status", "filters"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.status !== undefined && !["queued", "generating", "ready", "failed", "archived"].includes(String(patch.status))) {
      throw new ApiError(422, "Select a supported report status.", "validation_error");
    }
    if (existing.status === "archived" && patch.status !== "ready") {
      throw new ApiError(409, "An archived report can only be restored to the ready state.", "conflict");
    }
    const filters = patch.filters && typeof patch.filters === "object" && !Array.isArray(patch.filters)
      ? patch.filters as Record<string, unknown>
      : existing.filters;
    const stationId = typeof filters.stationId === "string" && filters.stationId.length > 0 ? filters.stationId : null;
    if (stationId) {
      const station = (await listAllStations(ctx.user.organizationId)).find((entry) => entry.id === stationId);
      if (!station) return jsonError(notFound(), request);
      if (!userCanAccessStation(ctx.user, stationId)) return jsonError(notFound(), request);
    }
    if (!reportStationIsAllowed({ ...existing, filters }, stationScopeForUser(ctx.user))) {
      return jsonError(notFound(), request);
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
    return jsonOk(hasPermission(ctx.user, "reports.export") ? report : { ...report, fileUrl: null });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("reports.create", async (request, ctx) => {
  try {
    const reportId = ctx.params?.reportId ?? "";
    const existing = (await getReport(reportId));
    if (!existing || existing.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(existing, stationScopeForUser(ctx.user))) return jsonError(notFound(), request);
    const report = await archiveReport(reportId);
    (await audit({
      user: ctx.user,
      action: "archived",
      entity: "report",
      entityId: existing.id,
      entityLabel: existing.title,
      summary: `${ctx.user.name} archived report "${existing.title}"`,
      previous: existing,
      next: report,
      request,
    }));
    return jsonOk({ id: reportId, archived: true, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
