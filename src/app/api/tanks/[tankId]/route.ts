import { deleteTank, getTank, listFuelTypes, updateTank } from "@/server/db/repo/stations";
import {
  ApiError,
  audit,
  jsonError,
  jsonOk,
  notFound,
  parseJsonBody,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("tanks.view", async (request, ctx) => {
  try {
    const tank = (await getTank(ctx.params?.tankId ?? ""));
    if (
      !tank ||
      tank.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(tank.stationId))
    ) return jsonError(notFound(), request);
    return jsonOk(tank);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("tanks.edit", async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const existing = (await getTank(tankId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(existing.stationId))
    ) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    const allowed = [
      "name",
      "code",
      "fuelTypeId",
      "capacity",
      "tankType",
      "manufacturer",
      "installationDate",
      "minLevel",
      "lowThresholdPct",
      "criticalThresholdPct",
      "overfillThresholdPct",
      "notes",
      "isArchived",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.capacity != null && Number(patch.capacity) <= 0) {
      throw new ApiError(422, "Tank capacity must be a positive number of liters.", "validation_error");
    }
    if (patch.fuelTypeId != null) {
      const fuelTypes = await listFuelTypes(ctx.user.organizationId);
      if (!fuelTypes.some((fuelType) => fuelType.id === String(patch.fuelTypeId))) {
        throw new ApiError(422, "The selected fuel type does not exist in your organization.", "validation_error");
      }
    }
    const tank = (await updateTank(tankId, patch));
    if (!tank) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "tank",
      entityId: tank.id,
      entityLabel: tank.name,
      summary: `${ctx.user.name} updated ${tank.name}`,
      previous: existing,
      next: tank,
      request,
    }));
    return jsonOk(tank);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("tanks.delete", async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const existing = (await getTank(tankId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(existing.stationId))
    ) return jsonError(notFound(), request);
    const hard = new URL(request.url).searchParams.get("hard") === "true";
    if (hard) (await deleteTank(tankId));
    else (await updateTank(tankId, { isArchived: true }));
    (await audit({
      user: ctx.user,
      action: hard ? "deleted" : "archived",
      entity: "tank",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} ${hard ? "deleted" : "archived"} ${existing.name}`,
      previous: existing,
      request,
    }));
    return jsonOk({ id: tankId, archived: !hard, deleted: hard });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
