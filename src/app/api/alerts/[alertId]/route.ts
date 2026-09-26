import { acknowledgeAlert, getAlert, resolveAlert } from "@/server/db/repo/alerts";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alerts.view", async (request, ctx) => {
  try {
    const alert = getAlert(ctx.params?.alertId ?? "");
    if (!alert || alert.organizationId !== ctx.user.organizationId) {
      return jsonError(notFound("Alert not found."));
    }
    return jsonOk(alert);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("alerts.acknowledge", async (request, ctx) => {
  try {
    const alertId = ctx.params?.alertId ?? "";
    const body = await parseJsonBody<{ action?: string; note?: string }>(request);
    const action = body.action ?? "acknowledge";
    const alert = getAlert(alertId);
    if (!alert || alert.organizationId !== ctx.user.organizationId) {
      return jsonError(notFound("Alert not found."));
    }
    const updated =
      action === "resolve" ? resolveAlert(alertId, ctx.user.id, body.note) : acknowledgeAlert(alertId, ctx.user.id);
    if (!updated) {
      return jsonError(notFound("Alert not found."));
    }
    audit({
      user: ctx.user,
      action: action === "resolve" ? "resolved" : "acknowledged",
      entity: "alert",
      entityId: updated.id,
      entityLabel: updated.type,
      summary: `${ctx.user.name} ${action === "resolve" ? "resolved" : "acknowledged"} a ${updated.severity} alert`,
      previous: alert,
      next: updated,
      request,
    });
    return jsonOk(updated);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
