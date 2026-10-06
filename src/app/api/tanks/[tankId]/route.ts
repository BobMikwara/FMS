import { userCanAccessStation } from "@/server/auth/authorization";
import { tankStateForPercent } from "@/lib/status";
import { validateTankThresholds } from "@/lib/tank-thresholds";
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
    if (patch.capacity !== undefined) {
      const capacity = Number(patch.capacity);
      if (!Number.isFinite(capacity) || capacity <= 0) {
        throw new ApiError(422, "Tank capacity must be a positive number of liters.", "validation_error");
      }
      if (capacity > 5_000_000) {
        throw new ApiError(422, "Tank capacity looks implausibly large. Please check the value.", "validation_error");
      }
      patch.capacity = capacity;
    }
    const thresholdKeys = ["criticalThresholdPct", "lowThresholdPct", "overfillThresholdPct"] as const;
    const thresholdOrCapacityChanged = patch.capacity !== undefined || thresholdKeys.some((key) => patch[key] !== undefined);
    if (thresholdOrCapacityChanged) {
      const thresholds = {
        criticalThresholdPct: thresholdNumber(patch.criticalThresholdPct, existing.criticalThresholdPct, "Critical threshold"),
        lowThresholdPct: thresholdNumber(patch.lowThresholdPct, existing.lowThresholdPct, "Low threshold"),
        overfillThresholdPct: thresholdNumber(patch.overfillThresholdPct, existing.overfillThresholdPct, "Overfill threshold"),
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
      for (const key of thresholdKeys) {
        if (patch[key] !== undefined) patch[key] = thresholds[key];
      }
      const nextCapacity = patch.capacity === undefined ? existing.capacity : Number(patch.capacity);
      const currentPct = nextCapacity > 0 ? (existing.currentVolume / nextCapacity) * 100 : 0;
      patch.status = !existing.lastReadingAt || existing.status === "offline"
        ? "offline"
        : tankStateForPercent(
          currentPct,
          thresholds.criticalThresholdPct,
          thresholds.lowThresholdPct,
          thresholds.overfillThresholdPct,
        );
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
