import { createFuelType, listFuelTypes } from "@/server/db/repo/stations";
import {
  ApiError,
  audit,
  conflict,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  num,
  optionalNum,
  parseJsonBody,
  required,
  str,
  uniqueViolation,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("tanks.view", async (request, ctx) => {
  try {
    const rows = listFuelTypes(ctx.user.organizationId);
    return jsonOk({ rows, total: rows.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("fuel_types.manage", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const displayName = maxLen(required(body.displayName, "Fuel name"), 64, "Fuel name");
    const systemName = maxLen(required(body.systemName, "System key"), 32, "System key");
    if (!/^[a-z0-9_]+$/.test(systemName)) {
      throw new ApiError(422, "The system key may only contain lowercase letters, numbers and underscores.", "validation_error");
    }
    const existing = listFuelTypes(ctx.user.organizationId);
    if (existing.some((fuel) => fuel.systemName === systemName)) {
      throw conflict(`A fuel type with the system key "${systemName}" already exists. Choose a different key.`);
    }
    if (existing.some((fuel) => fuel.displayName.toLowerCase() === displayName.toLowerCase())) {
      throw conflict(`A fuel type called "${displayName}" already exists.`);
    }

    let fuelType;
    try {
      fuelType = createFuelType({
        organizationId: ctx.user.organizationId,
        displayName,
        systemName,
        color: str(body.color, "#0f766e"),
        density: optionalNum(body.density),
      });
    } catch (error) {
      uniqueViolation(error, "A fuel type with this system key", "system key");
    }

    audit({
      user: ctx.user,
      action: "created",
      entity: "fuel_type",
      entityId: fuelType.id,
      entityLabel: fuelType.displayName,
      summary: `${ctx.user.name} added fuel type ${fuelType.displayName}`,
      next: fuelType,
      request,
    });
    return jsonCreated(fuelType);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
