import { deleteVehicle, getVehicle, updateVehicle } from "@/server/db/repo/devices";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { ApiError } from "@/server/api/route";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("vehicles.view", async (request, ctx) => {
  try {
    const vehicle = (await getVehicle(ctx.params?.vehicleId ?? ""));
    if (
      !vehicle ||
      vehicle.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && (!vehicle.stationId || !ctx.user.stationIds.includes(vehicle.stationId)))
    ) return jsonError(notFound(), request);
    return jsonOk(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("vehicles.edit", async (request, ctx) => {
  try {
    const vehicleId = ctx.params?.vehicleId ?? "";
    const existing = (await getVehicle(vehicleId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && (!existing.stationId || !ctx.user.stationIds.includes(existing.stationId)))
    ) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of [
      "name",
      "plateNumber",
      "type",
      "make",
      "model",
      "year",
      "fuelTypeId",
      "tankCapacity",
      "stationId",
      "status",
      "odometerKm",
      "driverName",
      "driverPhone",
      "notes",
      "isArchived",
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const [fuelTypes, stations] = await Promise.all([
      listFuelTypes(ctx.user.organizationId),
      listAllStations(ctx.user.organizationId),
    ]);
    if (patch.fuelTypeId && !fuelTypes.some((fuelType) => fuelType.id === String(patch.fuelTypeId))) {
      throw new ApiError(422, "The selected fuel type does not exist in your organization.", "validation_error");
    }
    if (patch.stationId && !stations.some((station) => station.id === String(patch.stationId))) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (patch.stationId && ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(String(patch.stationId))) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    const vehicle = (await updateVehicle(vehicleId, patch));
    if (!vehicle) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "vehicle",
      entityId: vehicle.id,
      entityLabel: vehicle.plateNumber,
      summary: `${ctx.user.name} updated vehicle ${vehicle.plateNumber}`,
      previous: existing,
      next: vehicle,
      request,
    }));
    return jsonOk(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("vehicles.delete", async (request, ctx) => {
  try {
    const vehicleId = ctx.params?.vehicleId ?? "";
    const existing = (await getVehicle(vehicleId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && (!existing.stationId || !ctx.user.stationIds.includes(existing.stationId)))
    ) return jsonError(notFound(), request);
    const hard = new URL(request.url).searchParams.get("hard") === "true";
    if (hard) (await deleteVehicle(vehicleId));
    else (await updateVehicle(vehicleId, { isArchived: true }));
    (await audit({
      user: ctx.user,
      action: hard ? "deleted" : "archived",
      entity: "vehicle",
      entityId: existing.id,
      entityLabel: existing.plateNumber,
      summary: `${ctx.user.name} ${hard ? "deleted" : "archived"} vehicle ${existing.plateNumber}`,
      previous: existing,
      request,
    }));
    return jsonOk({ id: vehicleId, deleted: hard });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
