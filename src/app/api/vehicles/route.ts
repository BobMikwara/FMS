import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { createVehicle, listVehicles } from "@/server/db/repo/devices";
import type { Vehicle } from "@/server/domain/types";
import { ApiError, audit, jsonCreated, jsonError, jsonOk, maxLen, optionalNum, parseJsonBody, parsePagination, required, str, withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("vehicles.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 24);
    const result = (await listVehicles({
      orgId: ctx.user.organizationId,
      status: params.get("status") ?? undefined,
      type: params.get("type") ?? undefined,
      search: params.get("search") ?? undefined,
      sort: params.get("sort") ?? "name",
      order: (params.get("order") as "asc" | "desc") ?? "asc",
      page,
      pageSize,
      includeArchived: params.get("archived") === "true",
      archivedOnly: params.get("archived") === "true",
      stationIds: stationScopeForUser(ctx.user),
    }));
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("vehicles.create", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const name = maxLen(required(body.name, "Vehicle name"), 120, "Vehicle name");
    const plateNumber = maxLen(required(body.plateNumber, "Plate number"), 32, "Plate number");
    const fuelTypes = (await listFuelTypes(ctx.user.organizationId, true));
    const requestedFuelTypeId = str(body.fuelTypeId);
    if (requestedFuelTypeId && !fuelTypes.some((fuelType) => fuelType.id === requestedFuelTypeId)) {
      throw new ApiError(422, "The selected fuel type does not exist in your organization.", "validation_error");
    }
    const stations = await listAllStations(ctx.user.organizationId);
    const requestedStationId = str(body.stationId);
    if (requestedStationId && !stations.some((station) => station.id === requestedStationId)) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (requestedStationId && !userCanAccessStation(ctx.user, requestedStationId)) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    if (stationScopeForUser(ctx.user) !== undefined && !requestedStationId) {
      throw new ApiError(403, "A station must be selected for a station-scoped vehicle.", "forbidden");
    }
  let vehicle!: Vehicle;
  try {
      vehicle = (await createVehicle({
        organizationId: ctx.user.organizationId,
        name,
        plateNumber: plateNumber.toUpperCase(),
        type: str(body.type, "tanker"),
        make: str(body.make) || null,
        model: str(body.model) || null,
        year: optionalNum(body.year),
        fuelTypeId: requestedFuelTypeId || fuelTypes[0]?.id || null,
        tankCapacity: optionalNum(body.tankCapacity),
        stationId: requestedStationId || null,
        status: (str(body.status, "active") as "active") ?? "active",
        odometerKm: optionalNum(body.odometerKm),
        driverName: str(body.driverName) || null,
        driverPhone: str(body.driverPhone) || null,
        notes: str(body.notes) || null,
      }));
  } catch (error) {
    uniqueViolation(error, "A vehicle with this plate number", "plate number");
  }
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "vehicle",
      entityId: vehicle.id,
      entityLabel: `${vehicle.name} (${vehicle.plateNumber})`,
      summary: `${ctx.user.name} added vehicle ${vehicle.plateNumber}`,
      next: vehicle,
      request,
    }));
    return jsonCreated(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
