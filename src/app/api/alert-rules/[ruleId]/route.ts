import { deleteAlertRule, getAlertRule, updateAlertRule } from "@/server/db/repo/alerts";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { ApiError } from "@/server/api/route";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("alert_rules.manage", async (request, ctx) => {
  try {
    const ruleId = ctx.params?.ruleId ?? "";
    const existing = (await getAlertRule(ruleId));
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    if (ctx.user.stationIds.length > 0) {
      const tanks = await listAllTanks(ctx.user.organizationId);
      const stationId = existing.stationId ?? tanks.find((tank) => tank.id === existing.tankId)?.stationId;
      if (!stationId || !ctx.user.stationIds.includes(stationId)) return jsonError(notFound(), request);
    }
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
    const [tanks, stations] = await Promise.all([
      listAllTanks(ctx.user.organizationId),
      listAllStations(ctx.user.organizationId),
    ]);
    if (patch.tankId && !tanks.some((tank) => tank.id === String(patch.tankId))) {
      throw new ApiError(422, "The selected tank does not exist in your organization.", "validation_error");
    }
    if (patch.stationId && !stations.some((station) => station.id === String(patch.stationId))) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (patch.stationId && ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(String(patch.stationId))) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    const rule = (await updateAlertRule(ruleId, patch));
    if (!rule) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "alert_rule",
      entityId: rule.id,
      entityLabel: rule.name,
      summary: `${ctx.user.name} updated alert rule "${rule.name}"`,
      previous: existing,
      next: rule,
      request,
    }));
    return jsonOk(rule);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("alert_rules.manage", async (request, ctx) => {
  try {
    const ruleId = ctx.params?.ruleId ?? "";
    const existing = (await getAlertRule(ruleId));
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    if (ctx.user.stationIds.length > 0) {
      const tanks = await listAllTanks(ctx.user.organizationId);
      const stationId = existing.stationId ?? tanks.find((tank) => tank.id === existing.tankId)?.stationId;
      if (!stationId || !ctx.user.stationIds.includes(stationId)) return jsonError(notFound(), request);
    }
    (await deleteAlertRule(ruleId));
    (await audit({
      user: ctx.user,
      action: "deleted",
      entity: "alert_rule",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} deleted alert rule "${existing.name}"`,
      previous: existing,
      request,
    }));
    return jsonOk({ id: ruleId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
