import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { validateTankThresholds } from "@/lib/tank-thresholds";
import { createTank, getStation, listFuelTypes, listTanks } from "@/server/db/repo/stations";
import {
  ApiError,
  audit,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  num,
  parseJsonBody,
  parsePagination,
  required,
  str,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

function thresholdNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new ApiError(422, `${field} must be a finite percentage.`, "validation_error");
  }
  return parsed;
}

export const GET = withPermission("tanks.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 24);
    const result = (await listTanks({
      orgId: ctx.user.organizationId,
      stationId: params.get("stationId") ?? undefined,
      fuelTypeId: params.get("fuelTypeId") ?? undefined,
      status: params.get("status") ?? undefined,
      search: params.get("search") ?? undefined,
      lowOnly: params.get("low") === "true",
      sort: params.get("sort") ?? "name",
      order: (params.get("order") as "asc" | "desc") ?? "asc",
      page,
      pageSize,
      includeArchived: params.get("includeArchived") === "true" || params.get("archived") === "true",
      archivedOnly: params.get("archived") === "true",
      stationIds: stationScopeForUser(ctx.user),
    }));
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("tanks.create", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const name = maxLen(required(body.name, "Tank name"), 120, "Tank name");
    const code = maxLen(required(body.code, "Tank code"), 24, "Tank code");
    const stationId = required(body.stationId, "Station");
    const capacity = num(body.capacity, Number.NaN);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new ApiError(422, "Tank capacity must be a positive number of liters.", "validation_error");
    }
    if (capacity > 5_000_000) {
      throw new ApiError(422, "Tank capacity looks implausibly large. Please check the value.", "validation_error");
    }
    const thresholds = {
      criticalThresholdPct: thresholdNumber(body.criticalThresholdPct, 10, "Critical threshold"),
      lowThresholdPct: thresholdNumber(body.lowThresholdPct, 20, "Low threshold"),
      overfillThresholdPct: thresholdNumber(body.overfillThresholdPct, 95, "Overfill threshold"),
    };
    const thresholdValidation = validateTankThresholds(thresholds);
    if (!thresholdValidation.ok) {
      throw new ApiError(
        422,
        Object.values(thresholdValidation.errors)[0] ?? "Review the tank thresholds.",
        "validation_error",
        thresholdValidation.errors,
      );
    }
    const station = await getStation(stationId);
    if (!station || station.organizationId !== ctx.user.organizationId || station.isArchived) {
      throw new ApiError(422, "Select an active station in your organization.", "validation_error");
    }
    if (!userCanAccessStation(ctx.user, stationId)) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    const fuelTypes = (await listFuelTypes(ctx.user.organizationId, true));
    const requestedFuelTypeId = str(body.fuelTypeId);
    if (requestedFuelTypeId && !fuelTypes.some((fuelType) => fuelType.id === requestedFuelTypeId)) {
      throw new ApiError(422, "The selected fuel type does not exist in your organization.", "validation_error");
    }
    const fuelTypeId = requestedFuelTypeId || fuelTypes[0]?.id;
    if (!fuelTypeId) {
      throw new ApiError(422, "Create at least one fuel type before adding tanks.", "validation_error");
    }
    const tank = (await createTank({
      organizationId: ctx.user.organizationId,
      stationId,
      fuelTypeId,
      name,
      code: code.toUpperCase(),
      capacity,
      tankType: str(body.tankType, "underground"),
      manufacturer: str(body.manufacturer) || null,
      installationDate: str(body.installationDate) || null,
      minLevel: num(body.minLevel, 0),
      ...thresholds,
      notes: str(body.notes) || null,
    }));
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "tank",
      entityId: tank.id,
      entityLabel: tank.name,
      summary: `${ctx.user.name} created ${tank.name} (${Math.round(tank.capacity).toLocaleString()} L)`,
      next: tank,
      request,
    }));
    return jsonCreated(tank);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
