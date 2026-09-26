import { acknowledgeAlert, listAlerts, resolveAlert } from "@/server/db/repo/alerts";
import { jsonError, jsonOk, notFound, parseJsonBody, parsePagination, unprocessable, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alerts.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 20);
    const result = listAlerts({
      orgId: ctx.user.organizationId,
      status: params.get("status") ?? undefined,
      severity: params.get("severity") ?? undefined,
      type: params.get("type") ?? undefined,
      stationId: params.get("stationId") ?? undefined,
      search: params.get("search") ?? undefined,
      sort: params.get("sort") ?? "triggeredAt",
      order: (params.get("order") as "asc" | "desc") ?? "desc",
      page,
      pageSize,
    });
    // A supervisor scoped to specific stations only sees those stations' alerts.
    const rows =
      ctx.user.stationIds.length > 0
        ? result.rows.filter((alert) => ctx.user.stationIds.includes(alert.stationId))
        : result.rows;
    return jsonOk({ rows, total: rows.length, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("alerts.acknowledge", async (request, ctx) => {
  try {
    const body = await parseJsonBody<{ id?: string; action?: string; note?: string }>(request);
    if (!body.id) {
      return jsonError(unprocessable("Alert id is required."));
    }
    const action = body.action ?? "acknowledge";
    const alert =
      action === "resolve" ? resolveAlert(body.id, ctx.user.id, body.note) : acknowledgeAlert(body.id, ctx.user.id);
    if (!alert) {
      return jsonError(notFound("Alert not found."));
    }
    return jsonOk(alert);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
