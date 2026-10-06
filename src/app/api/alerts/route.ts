import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/session";
import { acknowledgeAlert, getAlert, listAlerts, resolveAlert } from "@/server/db/repo/alerts";
import { ApiError, audit, jsonError, jsonOk, notFound, parseJsonBody, parsePagination, unprocessable, withAnyPermission, withPermission } from "@/server/api/route";

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
      stationIds: stationScopeForUser(ctx.user),
    }));
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withAnyPermission(["alerts.acknowledge", "alerts.resolve"], async (request, ctx) => {
  try {
    const body = await parseJsonBody<{ id?: string; action?: string; note?: string }>(request);
    if (!body.id) {
      return jsonError(unprocessable("Alert id is required."));
    }
    const existing = await getAlert(body.id);
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, existing.stationId)
    ) {
      return jsonError(notFound("Alert not found."), request);
    }
    if (body.action !== undefined && body.action !== "resolve" && body.action !== "acknowledge") {
      return jsonError(unprocessable("Unsupported alert action."), request);
    }
    const action = body.action === "resolve" ? "resolve" : "acknowledge";
    if (!hasPermission(ctx.user, action === "resolve" ? "alerts.resolve" : "alerts.acknowledge")) {
      return jsonError(new ApiError(403, "You do not have permission to perform this alert action.", "forbidden"), request);
    }
    const alert =
      action === "resolve" ? await resolveAlert(body.id, ctx.user.id, body.note) : await acknowledgeAlert(body.id, ctx.user.id);
    if (!alert) {
      return jsonError(notFound("Alert not found."));
    }
    (await audit({
      user: ctx.user,
      action: action === "resolve" ? "resolved" : "acknowledged",
      entity: "alert",
      entityId: alert.id,
      entityLabel: alert.type,
      summary: `${ctx.user.name} ${action === "resolve" ? "resolved" : "acknowledged"} a ${alert.severity} alert`,
      previous: existing,
      next: alert,
      request,
    }));
    return jsonOk(alert);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
