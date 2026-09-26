import { listFuelTypes } from "@/server/db/repo/stations";
import { createVehicle, listVehicles } from "@/server/db/repo/devices";
import type { Vehicle } from "@/server/domain/types";
import { audit, jsonCreated, jsonError, jsonOk, maxLen, optionalNum, parseJsonBody, parsePagination, required, str, withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("vehicles.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 24);
    const result = listVehicles({
      orgId: ctx.user.organizationId,
      status: params.get("status") ?? undefined,
      type: params.get("type") ?? undefined,
      search: params.get("search") ?? undefined,
      sort: params.get("sort") ?? "name",
      order: (params.get("order") as "asc" | "desc") ?? "asc",
      page,
      pageSize,
      includeArchived: params.get("archived") === "true",
    });
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
    const fuelTypes = listFuelTypes(ctx.user.organizationId);
  let vehicle!: Vehicle;
  try {
      vehicle = createVehicle({
        organizationId: ctx.user.organizationId,
        name,
        plateNumber: plateNumber.toUpperCase(),
        type: str(body.type, "tanker"),
        make: str(body.make) || null,
        model: str(body.model) || null,
        year: optionalNum(body.year),
        fuelTypeId: str(body.fuelTypeId) || fuelTypes[0]?.id || null,
        tankCapacity: optionalNum(body.tankCapacity),
        stationId: str(body.stationId) || null,
        status: (str(body.status, "active") as "active") ?? "active",
        odometerKm: optionalNum(body.odometerKm),
        driverName: str(body.driverName) || null,
        driverPhone: str(body.driverPhone) || null,
        notes: str(body.notes) || null,
      });
  } catch (error) {
    uniqueViolation(error, "A vehicle with this plate number", "plate number");
  }
    audit({
      user: ctx.user,
      action: "created",
      entity: "vehicle",
      entityId: vehicle.id,
      entityLabel: `${vehicle.name} (${vehicle.plateNumber})`,
      summary: `${ctx.user.name} added vehicle ${vehicle.plateNumber}`,
      next: vehicle,
      request,
    });
    return jsonCreated(vehicle);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
