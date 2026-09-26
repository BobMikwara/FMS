import { deleteAlertRule, getAlertRule, updateAlertRule } from "@/server/db/repo/alerts";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("alert_rules.manage", async (request, ctx) => {
  try {
    const ruleId = ctx.params?.ruleId ?? "";
    const existing = getAlertRule(ruleId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of [
      "name",
      "description",
      "type",
      "scope",
      "tankId",
      "stationId",
      "deviceId",
      "fuelTypeId",
      "condition",
      "severity",
      "channels",
      "isEnabled",
      "cooldownMin",
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const rule = updateAlertRule(ruleId, patch);
    if (!rule) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "alert_rule",
      entityId: rule.id,
      entityLabel: rule.name,
      summary: `${ctx.user.name} updated alert rule "${rule.name}"`,
      previous: existing,
      next: rule,
      request,
    });
    return jsonOk(rule);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("alert_rules.manage", async (request, ctx) => {
  try {
    const ruleId = ctx.params?.ruleId ?? "";
    const existing = getAlertRule(ruleId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    deleteAlertRule(ruleId);
    audit({
      user: ctx.user,
      action: "deleted",
      entity: "alert_rule",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} deleted alert rule "${existing.name}"`,
      previous: existing,
      request,
    });
    return jsonOk({ id: ruleId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
