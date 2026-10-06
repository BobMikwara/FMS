import { userCanAccessAlertRule } from "@/server/services/alert-rule-access";
import { validateAlertRuleConfig } from "@/server/services/alert-rule-validation";
import { disableAlertRule, getAlertRule, updateAlertRule } from "@/server/db/repo/alerts";
import { listAllStations, listAllTanks, listFuelTypes } from "@/server/db/repo/stations";
import { listAllDevices } from "@/server/db/repo/devices";
import { ApiError } from "@/server/api/route";
import { audit, jsonError, jsonOk, maxLen, notFound, parseJsonBody, required, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("alert_rules.manage", async (request, ctx) => {
  try {
    const ruleId = ctx.params?.ruleId ?? "";
    const existing = (await getAlertRule(ruleId));
    if (!existing || existing.organizationId !== ctx.user.organizationId || !(await userCanAccessAlertRule(ctx.user, existing))) {
      return jsonError(notFound(), request);
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
    if (patch.name !== undefined) patch.name = maxLen(required(patch.name, "Rule name"), 120, "Rule name");
    if (patch.description !== undefined) {
      patch.description = patch.description == null ? null : maxLen(String(patch.description).trim(), 1000, "Description") || null;
    }
    if (patch.channels !== undefined) {
      if (!Array.isArray(patch.channels)) throw new ApiError(422, "Alert channels must be a list.", "validation_error");
      const channels = [...new Set(patch.channels.map((channel) => String(channel).trim()))];
      if (channels.some((channel) => !["in_app", "email", "sms", "push"].includes(channel))) {
        throw new ApiError(422, "Select only supported alert channels.", "validation_error");
      }
      patch.channels = channels;
    }
    if (patch.isEnabled !== undefined && typeof patch.isEnabled !== "boolean") {
      throw new ApiError(422, "Rule enabled state must be true or false.", "validation_error");
    }
    const [tanks, stations, devices, fuelTypes] = await Promise.all([
      listAllTanks(ctx.user.organizationId),
      listAllStations(ctx.user.organizationId),
      listAllDevices(ctx.user.organizationId),
      listFuelTypes(ctx.user.organizationId),
    ]);
    const normalizeId = (value: unknown): string | null => value == null ? null : String(value).trim() || null;
    const nextScope = String(patch.scope ?? existing.scope);
    const scopeChanged = nextScope !== existing.scope;
    const nextTankId = nextScope === "tank"
      ? patch.tankId !== undefined ? normalizeId(patch.tankId) : scopeChanged ? null : existing.tankId
      : null;
    const nextStationId = nextScope === "station"
      ? patch.stationId !== undefined ? normalizeId(patch.stationId) : scopeChanged ? null : existing.stationId
      : null;
    const nextDeviceId = nextScope === "device"
      ? patch.deviceId !== undefined ? normalizeId(patch.deviceId) : scopeChanged ? null : existing.deviceId
      : null;
    if (!["tank", "station", "device", "organization"].includes(nextScope)) {
      throw new ApiError(422, "Select a supported alert-rule scope.", "validation_error");
    }
    if (patch.tankId != null && nextScope !== "tank") throw new ApiError(422, "Tank targets require tank scope.", "validation_error");
    if (patch.stationId != null && nextScope !== "station") throw new ApiError(422, "Station targets require station scope.", "validation_error");
    if (patch.deviceId != null && nextScope !== "device") throw new ApiError(422, "Device targets require device scope.", "validation_error");
    if (nextScope === "tank" && !nextTankId && (scopeChanged || patch.tankId !== undefined)) {
      throw new ApiError(422, "A tank-scoped rule must be attached to a tank.", "validation_error");
    }
    if (nextScope === "station" && !nextStationId) throw new ApiError(422, "A station-scoped rule must be attached to a station.", "validation_error");
    if (nextScope === "device" && !nextDeviceId) throw new ApiError(422, "A device-scoped rule must be attached to a device.", "validation_error");
    if (nextTankId && !tanks.some((tank) => tank.id === nextTankId)) {
      throw new ApiError(422, "The selected tank does not exist in your organization.", "validation_error");
    }
    if (nextStationId && !stations.some((station) => station.id === nextStationId)) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (nextDeviceId && !devices.some((device) => device.id === nextDeviceId)) {
      throw new ApiError(422, "The selected device does not exist in your organization.", "validation_error");
    }
    const nextFuelTypeId = patch.fuelTypeId !== undefined ? normalizeId(patch.fuelTypeId) : existing.fuelTypeId;
    if (nextFuelTypeId && !fuelTypes.some((fuelType) => fuelType.id === nextFuelTypeId)) {
      throw new ApiError(422, "The selected fuel type does not exist in your organization.", "validation_error");
    }
    const nextType = String(patch.type ?? existing.type);
    const nextCondition = patch.condition && typeof patch.condition === "object" && !Array.isArray(patch.condition)
      ? patch.condition
      : patch.condition === undefined
        ? existing.condition
        : null;
    const nextSeverity = String(patch.severity ?? existing.severity);
    const nextCooldownMin = patch.cooldownMin === undefined ? existing.cooldownMin : Number(patch.cooldownMin);
    const configError = validateAlertRuleConfig({
      type: nextType,
      condition: nextCondition,
      severity: nextSeverity,
      cooldownMin: nextCooldownMin,
    });
    if (configError) throw new ApiError(422, configError, "validation_error");
    patch.scope = nextScope;
    patch.tankId = nextTankId;
    patch.stationId = nextStationId;
    patch.deviceId = nextDeviceId;
    patch.fuelTypeId = nextFuelTypeId;
    const candidateRule = {
      ...existing,
      scope: nextScope as typeof existing.scope,
      tankId: nextTankId,
      stationId: nextStationId,
      deviceId: nextDeviceId,
      fuelTypeId: nextFuelTypeId,
    };
    if (!(await userCanAccessAlertRule(ctx.user, candidateRule))) {
      throw new ApiError(403, "You are not scoped to the selected alert-rule target.", "forbidden");
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
    if (!existing || existing.organizationId !== ctx.user.organizationId || !(await userCanAccessAlertRule(ctx.user, existing))) {
      return jsonError(notFound(), request);
    }
    const rule = await disableAlertRule(ruleId);
    (await audit({
      user: ctx.user,
      action: "disabled",
      entity: "alert_rule",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} disabled alert rule "${existing.name}"`,
      previous: existing,
      next: rule,
      request,
    }));
    return jsonOk({ id: ruleId, isEnabled: false, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
