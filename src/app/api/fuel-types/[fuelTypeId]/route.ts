import { deactivateFuelType, getFuelType, updateFuelType } from "@/server/db/repo/stations";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const PATCH = withPermission("fuel_types.manage", async (request, ctx) => {
  try {
    const fuelTypeId = ctx.params?.fuelTypeId ?? "";
    const existing = (await getFuelType(fuelTypeId));
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["displayName", "systemName", "color", "density", "isActive"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const fuelType = (await updateFuelType(fuelTypeId, patch));
    if (!fuelType) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "fuel_type",
      entityId: fuelType.id,
      entityLabel: fuelType.displayName,
      summary: `${ctx.user.name} updated fuel type ${fuelType.displayName}`,
      previous: existing,
      next: fuelType,
      request,
    }));
    return jsonOk(fuelType);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("fuel_types.manage", async (request, ctx) => {
  try {
    const fuelTypeId = ctx.params?.fuelTypeId ?? "";
    const existing = (await getFuelType(fuelTypeId));
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const fuelType = await deactivateFuelType(fuelTypeId);
    (await audit({
      user: ctx.user,
      action: "deactivated",
      entity: "fuel_type",
      entityId: existing.id,
      entityLabel: existing.displayName,
      summary: `${ctx.user.name} deactivated fuel type ${existing.displayName}`,
      previous: existing,
      next: fuelType,
      request,
    }));
    return jsonOk({ id: fuelTypeId, isActive: false, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
