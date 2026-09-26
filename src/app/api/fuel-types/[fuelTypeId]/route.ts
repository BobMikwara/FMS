import { deleteFuelType, getFuelType, updateFuelType } from "@/server/db/repo/stations";
import { listAllTanks } from "@/server/db/repo/stations";
import { ApiError, audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("fuel_types.manage", async (request, ctx) => {
  try {
    const fuelTypeId = ctx.params?.fuelTypeId ?? "";
    const existing = getFuelType(fuelTypeId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["displayName", "systemName", "color", "density", "isActive"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const fuelType = updateFuelType(fuelTypeId, patch);
    if (!fuelType) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "fuel_type",
      entityId: fuelType.id,
      entityLabel: fuelType.displayName,
      summary: `${ctx.user.name} updated fuel type ${fuelType.displayName}`,
      previous: existing,
      next: fuelType,
      request,
    });
    return jsonOk(fuelType);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("fuel_types.manage", async (request, ctx) => {
  try {
    const fuelTypeId = ctx.params?.fuelTypeId ?? "";
    const existing = getFuelType(fuelTypeId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const tanks = listAllTanks(ctx.user.organizationId).filter((tank) => tank.fuelTypeId === fuelTypeId);
    if (tanks.length > 0) {
      throw new ApiError(
        409,
        `${existing.displayName} is used by ${tanks.length} tank${tanks.length === 1 ? "" : "s"}. Reassign them before deleting it.`,
        "conflict",
      );
    }
    deleteFuelType(fuelTypeId);
    audit({
      user: ctx.user,
      action: "deleted",
      entity: "fuel_type",
      entityId: existing.id,
      entityLabel: existing.displayName,
      summary: `${ctx.user.name} deleted fuel type ${existing.displayName}`,
      previous: existing,
      request,
    });
    return jsonOk({ id: fuelTypeId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
