import { userCanAccessStation } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/session";
import { archiveStation, getStation, listStations, updateStation } from "@/server/db/repo/stations";
import { buildStationDetail } from "@/server/services/analytics";
import { publicDevice } from "@/server/services/device-response";
import {
  ApiError,
  audit,
  forbidden,
  jsonError,
  jsonOk,
  notFound,
  parseJsonBody,
  withAnyPermission,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("stations.view", async (request, ctx) => {
  try {
    const stationId = ctx.params?.stationId ?? "";
    const station = await getStation(stationId);
    if (!station || station.organizationId !== ctx.user.organizationId || !userCanAccessStation(ctx.user, stationId)) {
      return jsonError(notFound(), request);
    }
    const detail = await buildStationDetail(stationId);
    if (!detail) return jsonError(notFound(), request);
    const canViewTanks = hasPermission(ctx.user, "tanks.view");
    const canViewReadings = hasPermission(ctx.user, "readings.view");
    const canViewMovements = hasPermission(ctx.user, "movements.view");
    const canViewAlerts = hasPermission(ctx.user, "alerts.view");
    const canViewDevices = hasPermission(ctx.user, "devices.view");
    return jsonOk({
      ...detail,
      tanks: canViewTanks ? detail.tanks : [],
      fuelTypes: canViewTanks ? detail.fuelTypes : [],
      devices: canViewDevices ? detail.devices.map(publicDevice) : [],
      alerts: canViewAlerts ? detail.alerts : [],
      totalFuel: canViewTanks ? detail.totalFuel : undefined,
      capacity: canViewTanks ? detail.capacity : undefined,
      utilizationPct: canViewTanks ? detail.utilizationPct : undefined,
      todayConsumption: canViewMovements ? detail.todayConsumption : undefined,
      todayRefills: canViewMovements ? detail.todayRefills : undefined,
      rangeConsumption: canViewMovements ? detail.rangeConsumption : undefined,
      rangeRefills: canViewMovements ? detail.rangeRefills : undefined,
      rangeSuspectedLoss: canViewMovements ? detail.rangeSuspectedLoss : undefined,
      movements: canViewMovements ? detail.movements : [],
      levelTrend: canViewReadings ? detail.levelTrend : [],
      movementTrend: canViewMovements ? detail.movementTrend : [],
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withAnyPermission(["stations.edit", "stations.archive", "stations.delete"], async (request, ctx) => {
  try {
    const stationId = ctx.params?.stationId ?? "";
    const existing = (await getStation(stationId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, stationId)
    ) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    const allowed = [
      "name",
      "code",
      "address",
      "city",
      "region",
      "country",
      "phone",
      "email",
      "latitude",
      "longitude",
      "status",
      "openingTime",
      "closingTime",
      "timezone",
      "currency",
      "volumeUnit",
      "notes",
      "isArchived",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (Object.keys(patch).some((key) => key !== "isArchived") && !hasPermission(ctx.user, "stations.edit")) {
      throw new ApiError(403, "You do not have permission to edit station details.", "forbidden");
    }
    if (patch.isArchived !== undefined && typeof patch.isArchived !== "boolean") {
      throw new ApiError(422, "Station archived state must be true or false.", "validation_error");
    }
    if (patch.isArchived !== undefined && !hasPermission(ctx.user, "stations.archive") && !hasPermission(ctx.user, "stations.delete")) {
      throw new ApiError(403, "You do not have permission to archive or restore stations.", "forbidden");
    }
    if (patch.latitude != null && Math.abs(Number(patch.latitude)) > 90) {
      throw new ApiError(422, "Latitude must be between -90 and 90.", "validation_error");
    }
    if (patch.longitude != null && Math.abs(Number(patch.longitude)) > 180) {
      throw new ApiError(422, "Longitude must be between -180 and 180.", "validation_error");
    }
    const station = (await updateStation(stationId, patch));
    if (!station) return jsonError(notFound(), request);
    const action = patch.isArchived === true ? "archived" : existing.isArchived && patch.isArchived === false ? "restored" : "updated";
    const actionText = action === "restored" ? "restored" : action;
    (await audit({
      user: ctx.user,
      action,
      entity: "station",
      entityId: station.id,
      entityLabel: station.name,
      summary: `${ctx.user.name} ${actionText} station ${station.name}`,
      previous: existing,
      next: station,
      request,
    }));
    return jsonOk(station);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("stations.delete", async (request, ctx) => {
  try {
    const stationId = ctx.params?.stationId ?? "";
    const existing = (await getStation(stationId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, stationId)
    ) return jsonError(notFound(), request);
    // Station history is referenced by tanks, devices, events and alerts.
    const station = await archiveStation(stationId);
    (await audit({
      user: ctx.user,
      action: "archived",
      entity: "station",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} archived station ${existing.name}`,
      previous: existing,
      next: station,
      request,
    }));
    return jsonOk({ id: stationId, archived: true, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
