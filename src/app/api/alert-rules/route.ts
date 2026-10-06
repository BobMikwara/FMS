import { stationScopeForUser } from "@/server/auth/authorization";
import type { AlertRule } from "@/server/domain/types";
import { createAlertRule, listAlertRules } from "@/server/db/repo/alerts";
import { listAllStations, listAllTanks, listFuelTypes } from "@/server/db/repo/stations";
import { listAllDevices } from "@/server/db/repo/devices";
import { userCanAccessAlertRule } from "@/server/services/alert-rule-access";
import { validateAlertRuleConfig } from "@/server/services/alert-rule-validation";
import {
  ApiError,
  audit,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  parseJsonBody,
  required,
  str,
  withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alert_rules.view", async (request, ctx) => {
  try {
    const rules = (await listAlertRules(ctx.user.organizationId, stationScopeForUser(ctx.user)));
    const tanks = (await listAllTanks(ctx.user.organizationId));
    const stations = (await listAllStations(ctx.user.organizationId));
    const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));
    const stationName = new Map(stations.map((station) => [station.id, station.name]));
    const rows = rules.map((rule) => ({
      ...rule,
      tankName: rule.tankId ? (tankName.get(rule.tankId) ?? null) : null,
      stationName: rule.stationId ? (stationName.get(rule.stationId) ?? null) : null,
    }));
    return jsonOk({ rows, total: rows.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("alert_rules.manage", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const name = maxLen(required(body.name, "Rule name"), 120, "Rule name");
    const type = maxLen(required(body.type, "Rule type"), 64, "Rule type");
    const severity = str(body.severity, "warning");
    const cooldownMin = body.cooldownMin == null || body.cooldownMin === "" ? 30 : Number(body.cooldownMin);
    const condition = body.condition ?? {};
    const configError = validateAlertRuleConfig({ type, condition, severity, cooldownMin });
    if (configError) throw new ApiError(422, configError, "validation_error");
    const requestedScope = str(body.scope, "tank");
    if (!["tank", "station", "device", "organization"].includes(requestedScope)) {
      throw new ApiError(422, "Select a supported alert-rule scope.", "validation_error");
    }
    const scope = requestedScope as AlertRule["scope"];
    const requestedTankId = str(body.tankId).trim() || null;
    const requestedStationId = str(body.stationId).trim() || null;
    const requestedDeviceId = str(body.deviceId).trim() || null;
    if (scope !== "tank" && requestedTankId) throw new ApiError(422, "Tank targets require tank scope.", "validation_error");
    if (scope !== "station" && requestedStationId) throw new ApiError(422, "Station targets require station scope.", "validation_error");
    if (scope !== "device" && requestedDeviceId) throw new ApiError(422, "Device targets require device scope.", "validation_error");
    const tankId = scope === "tank" ? requestedTankId : null;
    const stationId = scope === "station" ? requestedStationId : null;
    const deviceId = scope === "device" ? requestedDeviceId : null;
    if (scope === "tank" && !tankId) {
      throw new ApiError(422, "A tank-scoped rule must be attached to a tank.", "validation_error");
    }
    if (scope === "station" && !stationId) {
      throw new ApiError(422, "A station-scoped rule must be attached to a station.", "validation_error");
    }
    if (scope === "device" && !deviceId) {
      throw new ApiError(422, "A device-scoped rule must be attached to a device.", "validation_error");
    }
    const [tanks, devices, stations, fuelTypes] = await Promise.all([
      listAllTanks(ctx.user.organizationId),
      listAllDevices(ctx.user.organizationId),
      listAllStations(ctx.user.organizationId),
      listFuelTypes(ctx.user.organizationId),
    ]);
    const fuelTypeId = str(body.fuelTypeId).trim() || null;
    if (fuelTypeId && !fuelTypes.some((fuelType) => fuelType.id === fuelTypeId)) {
      throw new ApiError(422, "The selected fuel type does not exist in your organization.", "validation_error");
    }
    if (tankId && !tanks.some((tank) => tank.id === tankId)) {
      throw new ApiError(422, "The selected tank does not exist in your organization.", "validation_error");
    }
    if (stationId && !stations.some((station) => station.id === stationId)) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (deviceId && !devices.some((device) => device.id === deviceId)) {
      throw new ApiError(422, "The selected device does not exist in your organization.", "validation_error");
    }
    const requestedChannels = body.channels === undefined ? ["in_app"] : body.channels;
    if (!Array.isArray(requestedChannels)) {
      throw new ApiError(422, "Alert channels must be a list.", "validation_error");
    }
    const channels = [...new Set(requestedChannels.map((channel) => String(channel).trim()))];
    if (channels.some((channel) => !["in_app", "email", "sms", "push"].includes(channel))) {
      throw new ApiError(422, "Select only supported alert channels.", "validation_error");
    }
    if (body.isEnabled !== undefined && typeof body.isEnabled !== "boolean") {
      throw new ApiError(422, "Rule enabled state must be true or false.", "validation_error");
    }
    const candidateRule = { scope, stationId, tankId, deviceId };
    if (!(await userCanAccessAlertRule(ctx.user, candidateRule))) {
      throw new ApiError(403, "You are not scoped to the selected alert-rule target.", "forbidden");
    }
    let rule!: AlertRule;
    try {
      rule = await createAlertRule({
        organizationId: ctx.user.organizationId,
        name,
        description: str(body.description).trim() || null,
        type,
        scope: scope as AlertRule["scope"],
        tankId,
        stationId,
        deviceId,
        fuelTypeId,
        condition: condition as Record<string, unknown>,
        severity: severity as AlertRule["severity"],
        channels,
        isEnabled: body.isEnabled !== false,
        cooldownMin,
      });
    } catch (error) {
      uniqueViolation(error, "An alert rule with this name", "name");
    }
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "alert_rule",
      entityId: rule.id,
      entityLabel: rule.name,
      summary: `${ctx.user.name} created alert rule "${rule.name}"`,
      next: rule,
      request,
    }));
    return jsonCreated(rule);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
