import { hasOrganizationWideStationAccess, userCanAccessStation } from "@/server/auth/authorization";
import { randomBytes } from "node:crypto";
import { getDevice, getVehicle, hasActiveFuelProbe, listAllVehicles, retireDevice, updateDevice } from "@/server/db/repo/devices";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";
import { hashDeviceKey, hasPermission } from "@/server/auth/session";
import { getTank, listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { ApiError } from "@/server/api/route";
import { publicDevice } from "@/server/services/device-response";
import { transaction } from "@/server/db/client";
import { lockDeviceForUpdate } from "@/server/db/repo/devices";
import { lockTankForUpdate } from "@/server/db/repo/stations";

export const dynamic = "force-dynamic";

async function canAccessDevice(
  user: Parameters<typeof userCanAccessStation>[0],
  device: NonNullable<Awaited<ReturnType<typeof getDevice>>>,
): Promise<boolean> {
  if (hasOrganizationWideStationAccess(user)) return true;
  const stationIds = [
    device.stationId,
    device.tankId ? (await getTank(device.tankId))?.stationId ?? null : null,
    device.vehicleId ? (await getVehicle(device.vehicleId))?.stationId ?? null : null,
  ].filter((stationId): stationId is string => Boolean(stationId));
  return stationIds.length > 0 && stationIds.every((stationId) => userCanAccessStation(user, stationId));
}

export const GET = withPermission("devices.view", async (request, ctx) => {
  try {
    const device = (await getDevice(ctx.params?.deviceId ?? ""));
    if (
      !device ||
      device.organizationId !== ctx.user.organizationId ||
      !(await canAccessDevice(ctx.user, device))
    ) return jsonError(notFound(), request);
    return jsonOk(publicDevice(device));
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("devices.edit", async (request, ctx) => {
  try {
    const deviceId = ctx.params?.deviceId ?? "";
    const existing = (await getDevice(deviceId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !(await canAccessDevice(ctx.user, existing))
    ) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["label", "provider", "model", "firmware", "stationId", "tankId", "vehicleId", "status", "isActive"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.isActive !== undefined && typeof patch.isActive !== "boolean") {
      throw new ApiError(422, "Device active state must be true or false.", "validation_error");
    }
    if (patch.isActive === false && !hasPermission(ctx.user, "devices.delete")) {
      throw new ApiError(403, "You do not have permission to retire devices.", "forbidden");
    }
    if (patch.isActive === true && !hasPermission(ctx.user, "devices.edit")) {
      throw new ApiError(403, "You do not have permission to restore devices.", "forbidden");
    }
    if (patch.status !== undefined && !["online", "delayed", "offline", "fault", "never_connected"].includes(String(patch.status))) {
      throw new ApiError(422, "Select a supported device status.", "validation_error");
    }
    const [stations, tanks, vehicles] = await Promise.all([
      listAllStations(ctx.user.organizationId),
      listAllTanks(ctx.user.organizationId),
      listAllVehicles(ctx.user.organizationId),
    ]);
    if (patch.stationId && !stations.some((station) => station.id === String(patch.stationId))) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (patch.tankId && !tanks.some((tank) => tank.id === String(patch.tankId))) {
      throw new ApiError(422, "The selected tank does not exist in your organization.", "validation_error");
    }
    if (patch.vehicleId && !vehicles.some((vehicle) => vehicle.id === String(patch.vehicleId))) {
      throw new ApiError(422, "The selected vehicle does not exist in your organization.", "validation_error");
    }
    const nextStationId = patch.stationId !== undefined ? (String(patch.stationId) || null) : existing.stationId;
    const nextTankId = patch.tankId !== undefined ? (String(patch.tankId) || null) : existing.tankId;
    const nextVehicleId = patch.vehicleId !== undefined ? (String(patch.vehicleId) || null) : existing.vehicleId;
    const nextTank = nextTankId ? tanks.find((candidate) => candidate.id === nextTankId) : null;
    const nextVehicle = nextVehicleId ? vehicles.find((candidate) => candidate.id === nextVehicleId) : null;
    const willBeActive = patch.isActive !== undefined ? patch.isActive === true : existing.isActive;
    if (existing.type === "fuel_probe" && willBeActive && !nextTank) {
      throw new ApiError(422, "A fuel probe must remain assigned to a tank.", "validation_error");
    }
    if (existing.type === "gps_tracker" && willBeActive && !nextVehicle) {
      throw new ApiError(422, "A GPS tracker must remain assigned to a vehicle.", "validation_error");
    }
    const assignedStationIds = [nextStationId, nextTank?.stationId ?? null, nextVehicle?.stationId ?? null]
      .filter((stationId): stationId is string => Boolean(stationId));
    if (new Set(assignedStationIds).size > 1) {
      throw new ApiError(422, "The device and its assigned asset must belong to the same station.", "validation_error");
    }
    if (assignedStationIds.some((stationId) => !userCanAccessStation(ctx.user, stationId))) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    // Rotating an ingest key is how a probe is re-provisioned without deleting
    // its reading history. The new key is returned once and never stored raw.
    let rotatedApiKey: string | null = null;
    if (body.rotateApiKey === true) {
      rotatedApiKey = `dkey_${randomBytes(24).toString("base64url")}`;
      patch.apiKeyHash = hashDeviceKey(rotatedApiKey);
    }
    if (patch.status === "online" && existing.status !== "online") {
      // Manual "reconnect" only clears the offline state; a real reading is still required.
      patch.lastSeenAt = new Date().toISOString();
    }
    const updateResult = await transaction(async () => {
      await lockDeviceForUpdate(deviceId);
      const current = await getDevice(deviceId);
      if (
        !current ||
        current.organizationId !== ctx.user.organizationId ||
        !(await canAccessDevice(ctx.user, current))
      ) return null;

      const lockedNextStationId = patch.stationId !== undefined ? String(patch.stationId) || null : current.stationId;
      const lockedNextTankId = patch.tankId !== undefined ? String(patch.tankId) || null : current.tankId;
      const lockedNextVehicleId = patch.vehicleId !== undefined ? String(patch.vehicleId) || null : current.vehicleId;
      const finalTank = lockedNextTankId ? await getTank(lockedNextTankId) : null;
      const finalVehicle = lockedNextVehicleId ? await getVehicle(lockedNextVehicleId) : null;
      const willBeActive = patch.isActive !== undefined ? patch.isActive === true : current.isActive;

      if (current.type === "fuel_probe" && (!lockedNextTankId || !finalTank || finalTank.organizationId !== ctx.user.organizationId)) {
        throw new ApiError(422, "A fuel probe must remain assigned to a tank in your organization.", "validation_error");
      }
      if (current.type === "fuel_probe" && willBeActive && finalTank?.isArchived) {
        throw new ApiError(422, "An active fuel probe must be assigned to an active tank.", "validation_error");
      }
      if (current.type === "gps_tracker" && (!lockedNextVehicleId || !finalVehicle || finalVehicle.organizationId !== ctx.user.organizationId)) {
        throw new ApiError(422, "A GPS tracker must remain assigned to a vehicle in your organization.", "validation_error");
      }
      if (current.type === "gps_tracker" && willBeActive && finalVehicle?.isArchived) {
        throw new ApiError(422, "An active GPS tracker must be assigned to an active vehicle.", "validation_error");
      }
      const finalStationIds = [lockedNextStationId, finalTank?.stationId ?? null, finalVehicle?.stationId ?? null]
        .filter((stationId): stationId is string => Boolean(stationId));
      if (new Set(finalStationIds).size > 1) {
        throw new ApiError(422, "The device and its assigned asset must belong to the same station.", "validation_error");
      }
      if (finalStationIds.some((stationId) => !userCanAccessStation(ctx.user, stationId))) {
        throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
      }

      if (current.type === "fuel_probe" && willBeActive && lockedNextTankId) {
        const lockedTank = await lockTankForUpdate(lockedNextTankId);
        if (!lockedTank || lockedTank.organizationId !== ctx.user.organizationId || lockedTank.isArchived) {
          throw new ApiError(422, "Select an active tank in your organization.", "validation_error");
        }
        if (await hasActiveFuelProbe(lockedNextTankId, deviceId)) {
          throw new ApiError(409, "The selected tank already has an active fuel probe.", "conflict");
        }
      }

      const device = await updateDevice(deviceId, patch);
      return device ? { device, previous: current } : null;
    });
    if (!updateResult) return jsonError(notFound(), request);
    const { device, previous } = updateResult;
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "device",
      entityId: device.id,
      entityLabel: device.serialNumber,
      summary: `${ctx.user.name} ${rotatedApiKey ? "rotated the ingest key for" : "updated"} device ${device.serialNumber}`,
      previous: publicDevice(previous),
      next: publicDevice(device),
      request,
    }));
    // The raw key is returned exactly once; only its hash is ever stored.
    return jsonOk(rotatedApiKey ? { ...publicDevice(device), apiKey: rotatedApiKey } : publicDevice(device));
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("devices.delete", async (request, ctx) => {
  try {
    const deviceId = ctx.params?.deviceId ?? "";
    const existing = (await getDevice(deviceId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !(await canAccessDevice(ctx.user, existing))
    ) return jsonError(notFound(), request);
    const device = await retireDevice(deviceId);
    if (!device) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: "retired",
      entity: "device",
      entityId: existing.id,
      entityLabel: existing.serialNumber,
      summary: `${ctx.user.name} retired device ${existing.serialNumber}`,
      previous: publicDevice(existing),
      next: publicDevice(device),
      request,
    }));
    return jsonOk({ id: deviceId, retired: true, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
