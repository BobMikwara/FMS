import type { AlertRule } from "@/server/domain/types";
import { createAlertRule, listAlertRules } from "@/server/db/repo/alerts";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import {
  ApiError,
  audit,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  num,
  parseJsonBody,
  required,
  str,
  withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alert_rules.view", async (request, ctx) => {
  try {
    const rules = listAlertRules(ctx.user.organizationId);
    const tanks = listAllTanks(ctx.user.organizationId);
    const stations = listAllStations(ctx.user.organizationId);
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
    const scope = str(body.scope, "tank") as "tank" | "station" | "device" | "vehicle" | "organization";
    if (scope === "tank" && !body.tankId) {
      throw new ApiError(422, "A tank-scoped rule must be attached to a tank.", "validation_error");
    }
    if (scope === "station" && !body.stationId) {
      throw new ApiError(422, "A station-scoped rule must be attached to a station.", "validation_error");
    }
  let rule!: AlertRule;
  try {
      rule = createAlertRule({
        organizationId: ctx.user.organizationId,
        name,
        description: str(body.description) || null,
        type,
        scope,
        tankId: str(body.tankId) || null,
        stationId: str(body.stationId) || null,
        deviceId: str(body.deviceId) || null,
        fuelTypeId: str(body.fuelTypeId) || null,
        condition: (body.condition ?? {}) as Record<string, unknown>,
        severity: (str(body.severity, "warning") as "critical" | "warning" | "info") ?? "warning",
        channels: Array.isArray(body.channels) ? (body.channels as string[]) : ["in_app"],
        isEnabled: body.isEnabled !== false,
        cooldownMin: num(body.cooldownMin, 30),
      });
  } catch (error) {
    uniqueViolation(error, "An alert rule with this name", "name");
  }
    audit({
      user: ctx.user,
      action: "created",
      entity: "alert_rule",
      entityId: rule.id,
      entityLabel: rule.name,
      summary: `${ctx.user.name} created alert rule "${rule.name}"`,
      next: rule,
      request,
    });
    return jsonCreated(rule);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
