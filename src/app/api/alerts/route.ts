import { acknowledgeAlert, getAlert, listAlerts, resolveAlert } from "@/server/db/repo/alerts";
import { jsonError, jsonOk, notFound, parseJsonBody, parsePagination, unprocessable, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alerts.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 20);
    const result = (await listAlerts({
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
      stationIds: ctx.user.stationIds.length > 0 ? ctx.user.stationIds : undefined,
    }));
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
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
    const existing = await getAlert(body.id);
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(existing.stationId))
    ) {
      return jsonError(notFound("Alert not found."), request);
    }
    const action = body.action === "resolve" ? "resolve" : "acknowledge";
    const alert =
      action === "resolve" ? await resolveAlert(body.id, ctx.user.id, body.note) : await acknowledgeAlert(body.id, ctx.user.id);
    if (!alert) {
      return jsonError(notFound("Alert not found."));
    }
    return jsonOk(alert);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
