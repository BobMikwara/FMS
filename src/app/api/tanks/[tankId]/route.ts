import { userCanAccessStation } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/session";
import { archiveTank, getTank, listFuelTypes, updateTank } from "@/server/db/repo/stations";
import {
  ApiError,
  audit,
  jsonError,
  jsonOk,
  notFound,
  parseJsonBody,
  withAnyPermission,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("tanks.view", async (request, ctx) => {
  try {
    const tank = (await getTank(ctx.params?.tankId ?? ""));
    if (
      !tank ||
      tank.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, tank.stationId)
    ) return jsonError(notFound(), request);
    return jsonOk(tank);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withAnyPermission(["tanks.edit", "tanks.delete"], async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const existing = (await getTank(tankId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, existing.stationId)
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
    if (Object.keys(patch).some((key) => key !== "isArchived") && !hasPermission(ctx.user, "tanks.edit")) {
      throw new ApiError(403, "You do not have permission to edit tank details.", "forbidden");
    }
    if (patch.isArchived !== undefined && typeof patch.isArchived !== "boolean") {
      throw new ApiError(422, "Tank archived state must be true or false.", "validation_error");
    }
    if (patch.isArchived !== undefined && !hasPermission(ctx.user, "tanks.delete")) {
      throw new ApiError(403, "You do not have permission to archive or restore tanks.", "forbidden");
    }
    if (patch.capacity != null && Number(patch.capacity) <= 0) {
      throw new ApiError(422, "Tank capacity must be a positive number of liters.", "validation_error");
    }
    if (patch.fuelTypeId != null) {
      const fuelTypes = await listFuelTypes(ctx.user.organizationId);
      const selectedFuelType = fuelTypes.find((fuelType) => fuelType.id === String(patch.fuelTypeId));
      if (!selectedFuelType || (!selectedFuelType.isActive && selectedFuelType.id !== existing.fuelTypeId)) {
        throw new ApiError(422, "Select an active fuel type for a new tank assignment.", "validation_error");
      }
    }
    const tank = (await updateTank(tankId, patch));
    if (!tank) return jsonError(notFound(), request);
    const action = patch.isArchived === true ? "archived" : existing.isArchived && patch.isArchived === false ? "restored" : "updated";
    (await audit({
      user: ctx.user,
      action,
      entity: "tank",
      entityId: tank.id,
      entityLabel: tank.name,
      summary: `${ctx.user.name} ${action} tank ${tank.name}`,
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
      !userCanAccessStation(ctx.user, existing.stationId)
    ) return jsonError(notFound(), request);
    const tank = await archiveTank(tankId);
    (await audit({
      user: ctx.user,
      action: "archived",
      entity: "tank",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} archived ${existing.name}`,
      previous: existing,
      next: tank,
      request,
    }));
    return jsonOk({ id: tankId, archived: true, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
