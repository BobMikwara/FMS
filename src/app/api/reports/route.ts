import { createReport, listReports } from "@/server/db/repo/reports";
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

export const dynamic = "force-dynamic";

export const GET = withPermission("reports.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 20);
    const result = listReports({
      orgId: ctx.user.organizationId,
      category: params.get("category") ?? undefined,
      status: params.get("status") ?? undefined,
      search: params.get("search") ?? undefined,
      page,
      pageSize,
    });
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
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
    if (new Date(dateFrom).getTime() > new Date(dateTo).getTime()) {
      throw new ApiError(422, "The start date must be before the end date.", "validation_error");
    }
    const report = createReport({
      organizationId: ctx.user.organizationId,
      createdById: ctx.user.id,
      title,
      category,
      period,
      dateFrom,
      dateTo,
      filters: (body.filters ?? {}) as Record<string, unknown>,
      status: "ready",
      format: str(body.format ?? body.fileFormat, "pdf") as "pdf" | "excel" | "csv",
    });
    audit({
      user: ctx.user,
      action: "created",
      entity: "report",
      entityId: report.id,
      entityLabel: report.title,
      summary: `${ctx.user.name} generated report "${report.title}"`,
      next: report,
      request,
    });
    return jsonCreated(report);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
