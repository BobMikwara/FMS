import { hasOrganizationWideStationAccess, stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { archiveVehicle, getVehicle, updateVehicle } from "@/server/db/repo/devices";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { ApiError } from "@/server/api/route";
import { hasPermission } from "@/server/auth/session";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withAnyPermission, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("vehicles.view", async (request, ctx) => {
  try {
    const vehicle = (await getVehicle(ctx.params?.vehicleId ?? ""));
    if (
      !vehicle ||
      vehicle.organizationId !== ctx.user.organizationId ||
      (!hasOrganizationWideStationAccess(ctx.user) && !userCanAccessStation(ctx.user, vehicle.stationId))
    ) return jsonError(notFound(), request);
    return jsonOk(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withAnyPermission(["vehicles.edit", "vehicles.delete"], async (request, ctx) => {
  try {
    const vehicleId = ctx.params?.vehicleId ?? "";
    const existing = (await getVehicle(vehicleId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (!hasOrganizationWideStationAccess(ctx.user) && !userCanAccessStation(ctx.user, existing.stationId))
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
    if (Object.keys(patch).some((key) => key !== "isArchived") && !hasPermission(ctx.user, "vehicles.edit")) {
      throw new ApiError(403, "You do not have permission to edit vehicle details.", "forbidden");
    }
    if (patch.isArchived !== undefined && typeof patch.isArchived !== "boolean") {
      throw new ApiError(422, "Vehicle archived state must be true or false.", "validation_error");
    }
    if (patch.isArchived !== undefined && !hasPermission(ctx.user, "vehicles.delete")) {
      throw new ApiError(403, "You do not have permission to archive or restore vehicles.", "forbidden");
    }
    const [fuelTypes, stations] = await Promise.all([
      listFuelTypes(ctx.user.organizationId),
      listAllStations(ctx.user.organizationId),
    ]);
    if (patch.fuelTypeId) {
      const selectedFuelType = fuelTypes.find((fuelType) => fuelType.id === String(patch.fuelTypeId));
      if (!selectedFuelType || (!selectedFuelType.isActive && selectedFuelType.id !== existing.fuelTypeId)) {
        throw new ApiError(422, "Select an active fuel type for a new vehicle assignment.", "validation_error");
      }
    }
    if (patch.stationId !== undefined) {
      const stationId = patch.stationId ? String(patch.stationId) : null;
      if (stationId && !stations.some((station) => station.id === stationId)) {
        throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
      }
      if (stationScopeForUser(ctx.user) !== undefined && !stationId) {
        throw new ApiError(403, "A station-scoped user cannot move a vehicle outside station scope.", "forbidden");
      }
      if (stationId && !userCanAccessStation(ctx.user, stationId)) {
        throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
      }
      patch.stationId = stationId;
    }
    const vehicle = (await updateVehicle(vehicleId, patch));
    if (!vehicle) return jsonError(notFound(), request);
    const action = patch.isArchived === true ? "archived" : existing.isArchived && patch.isArchived === false ? "restored" : "updated";
    (await audit({
      user: ctx.user,
      action,
      entity: "vehicle",
      entityId: vehicle.id,
      entityLabel: vehicle.plateNumber,
      summary: `${ctx.user.name} ${action} vehicle ${vehicle.plateNumber}`,
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
      (!hasOrganizationWideStationAccess(ctx.user) && !userCanAccessStation(ctx.user, existing.stationId))
    ) return jsonError(notFound(), request);
    const vehicle = await archiveVehicle(vehicleId);
    (await audit({
      user: ctx.user,
      action: "archived",
      entity: "vehicle",
      entityId: existing.id,
      entityLabel: existing.plateNumber,
      summary: `${ctx.user.name} archived vehicle ${existing.plateNumber}`,
      previous: existing,
      next: vehicle,
      request,
    }));
    return jsonOk({ id: vehicleId, archived: true, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
