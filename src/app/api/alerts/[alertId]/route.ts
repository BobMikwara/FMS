import { userCanAccessStation } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/session";
import { acknowledgeAlert, getAlert, resolveAlert } from "@/server/db/repo/alerts";
import { ApiError, audit, jsonError, jsonOk, notFound, parseJsonBody, unprocessable, withAnyPermission, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alerts.view", async (request, ctx) => {
  try {
    const alert = (await getAlert(ctx.params?.alertId ?? ""));
    if (
      !alert ||
      alert.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, alert.stationId)
    ) {
      return jsonError(notFound("Alert not found."));
    }
    return jsonOk(alert);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withAnyPermission(["alerts.acknowledge", "alerts.resolve"], async (request, ctx) => {
  try {
    const alertId = ctx.params?.alertId ?? "";
    const body = await parseJsonBody<{ action?: string; note?: string }>(request);
    const action = body.action ?? "acknowledge";
    if (action !== "acknowledge" && action !== "resolve") {
      return jsonError(unprocessable("Unsupported alert action."), request);
    }
    if (!hasPermission(ctx.user, action === "resolve" ? "alerts.resolve" : "alerts.acknowledge")) {
      return jsonError(new ApiError(403, "You do not have permission to perform this alert action.", "forbidden"), request);
    }
    const alert = (await getAlert(alertId));
    if (
      !alert ||
      alert.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, alert.stationId)
    ) {
      return jsonError(notFound("Alert not found."));
    }
    const updated =
      action === "resolve" ? (await resolveAlert(alertId, ctx.user.id, body.note)) : (await acknowledgeAlert(alertId, ctx.user.id));
    if (!updated) {
      return jsonError(notFound("Alert not found."));
    }
    (await audit({
      user: ctx.user,
      action: action === "resolve" ? "resolved" : "acknowledged",
      entity: "alert",
      entityId: updated.id,
      entityLabel: updated.type,
      summary: `${ctx.user.name} ${action === "resolve" ? "resolved" : "acknowledged"} a ${updated.severity} alert`,
      previous: alert,
      next: updated,
      request,
    }));
    return jsonOk(updated);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
