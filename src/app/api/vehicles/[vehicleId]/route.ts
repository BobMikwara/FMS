import { deleteVehicle, getVehicle, updateVehicle } from "@/server/db/repo/devices";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("vehicles.view", async (request, ctx) => {
  try {
    const vehicle = getVehicle(ctx.params?.vehicleId ?? "");
    if (!vehicle || vehicle.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    return jsonOk(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("vehicles.edit", async (request, ctx) => {
  try {
    const vehicleId = ctx.params?.vehicleId ?? "";
    const existing = getVehicle(vehicleId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
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
    const vehicle = updateVehicle(vehicleId, patch);
    if (!vehicle) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "vehicle",
      entityId: vehicle.id,
      entityLabel: vehicle.plateNumber,
      summary: `${ctx.user.name} updated vehicle ${vehicle.plateNumber}`,
      previous: existing,
      next: vehicle,
      request,
    });
    return jsonOk(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("vehicles.delete", async (request, ctx) => {
  try {
    const vehicleId = ctx.params?.vehicleId ?? "";
    const existing = getVehicle(vehicleId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const hard = new URL(request.url).searchParams.get("hard") === "true";
    if (hard) deleteVehicle(vehicleId);
    else updateVehicle(vehicleId, { isArchived: true });
    audit({
      user: ctx.user,
      action: hard ? "deleted" : "archived",
      entity: "vehicle",
      entityId: existing.id,
      entityLabel: existing.plateNumber,
      summary: `${ctx.user.name} ${hard ? "deleted" : "archived"} vehicle ${existing.plateNumber}`,
      previous: existing,
      request,
    });
    return jsonOk({ id: vehicleId, deleted: hard });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
