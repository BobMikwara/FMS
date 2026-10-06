import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { createReport, listReports } from "@/server/db/repo/reports";
import { listAllStations } from "@/server/db/repo/stations";
import { getOrganization } from "@/server/db/repo/core";
import { normalizeTimeZone } from "@/server/services/time-zone";
import { isoDaysAgo } from "@/lib/utils";
import {
  ApiError,
  audit,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  parseJsonBody,
  parsePagination,
  required,
  str,
  withPermission,
} from "@/server/api/route";
import { hasPermission } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 20);
    const result = (await listReports({
      orgId: ctx.user.organizationId,
      category: params.get("category") ?? undefined,
      status: params.get("status") ?? undefined,
      search: params.get("search") ?? undefined,
      page,
      pageSize,
      stationIds: stationScopeForUser(ctx.user),
      archivedOnly: params.get("archived") === "true",
    }));
    const rows = hasPermission(ctx.user, "reports.export")
      ? result.rows
      : result.rows.map((report) => ({ ...report, fileUrl: null }));
    return jsonOk({ rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("reports.create", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const title = maxLen(required(body.title, "Report title"), 160, "Report title");
    const category = str(body.category, "consumption") as string;
    const period = str(body.period, "custom") as string;
    const dateFrom = str(body.dateFrom) || isoDaysAgo(7);
    const dateTo = str(body.dateTo) || new Date().toISOString();
    const fromTimestamp = Date.parse(dateFrom);
    const toTimestamp = Date.parse(dateTo);
    if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
      throw new ApiError(422, "Provide valid report start and end timestamps.", "validation_error");
    }
    if (fromTimestamp > toTimestamp) {
      throw new ApiError(422, "The start date must be before the end date.", "validation_error");
    }
    const filters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
      ? body.filters as Record<string, unknown>
      : {};
    const stationId = typeof filters.stationId === "string" && filters.stationId.length > 0 ? filters.stationId : null;
    const [stations, organization] = await Promise.all([
      listAllStations(ctx.user.organizationId),
      getOrganization(ctx.user.organizationId),
    ]);
    const selectedStation = stationId ? stations.find((entry) => entry.id === stationId) : null;
    if (stationId) {
      if (!selectedStation) throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
      if (!userCanAccessStation(ctx.user, stationId)) {
        throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
      }
    } else if (stationScopeForUser(ctx.user) !== undefined) {
      throw new ApiError(403, "A station must be selected for a station-scoped report.", "forbidden");
    }
    const timeZone = normalizeTimeZone(selectedStation?.timezone ?? organization?.timezone);
    const report = (await createReport({
      organizationId: ctx.user.organizationId,
      createdById: ctx.user.id,
      title,
      category,
      period,
      dateFrom,
      dateTo,
      filters: { ...filters, timeZone },
      status: "ready",
      format: str(body.format ?? body.fileFormat, "pdf") as "pdf" | "excel" | "csv",
    }));
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "report",
      entityId: report.id,
      entityLabel: report.title,
      summary: `${ctx.user.name} generated report "${report.title}"`,
      next: report,
      request,
    }));
    return jsonCreated(report);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
