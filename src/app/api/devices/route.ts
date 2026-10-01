import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import type { Device } from "@/server/domain/types";
import { randomBytes } from "node:crypto";
import { createDevice, hasActiveFuelProbe, listDevices } from "@/server/db/repo/devices";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { listAllVehicles } from "@/server/db/repo/devices";
import { ApiError, audit, jsonCreated, jsonError, jsonOk, maxLen, parseJsonBody, parsePagination, required, str, withPermission,
  uniqueViolation,
} from "@/server/api/route";
import { hashDeviceKey } from "@/server/auth/session";
import { publicDevice } from "@/server/services/device-response";
import { transaction } from "@/server/db/client";
import { lockTankForUpdate } from "@/server/db/repo/stations";

/** Generates a per-device ingest key. Returned to the caller exactly once. */
function newDeviceApiKey(): string {
  return `dkey_${randomBytes(24).toString("base64url")}`;
}

export const dynamic = "force-dynamic";

export const GET = withPermission("devices.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 24);
    const result = (await listDevices({
      orgId: ctx.user.organizationId,
      type: params.get("type") ?? undefined,
      status: params.get("status") ?? undefined,
      isActive: params.get("active") == null ? undefined : params.get("active") === "true",
      reporting: (params.get("reporting") as "ok" | "problem" | null) ?? undefined,
      stationId: params.get("stationId") ?? undefined,
      tankId: params.get("tankId") ?? undefined,
      vehicleId: params.get("vehicleId") ?? undefined,
      provider: params.get("provider") ?? undefined,
      search: params.get("search") ?? undefined,
      sort: params.get("sort") ?? "serialNumber",
      order: (params.get("order") as "asc" | "desc") ?? "asc",
      page,
      pageSize,
      stationIds: stationScopeForUser(ctx.user),
    }));
    const stations = (await listAllStations(ctx.user.organizationId));
    const tanks = (await listAllTanks(ctx.user.organizationId));
    const vehicles = (await listAllVehicles(ctx.user.organizationId));
    const stationName = new Map(stations.map((station) => [station.id, station.name]));
    const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));
    const vehicleName = new Map(vehicles.map((vehicle) => [vehicle.id, `${vehicle.name} (${vehicle.plateNumber})`]));
    const rows = result.rows.map((device) => ({
      ...publicDevice(device),
      stationName: device.stationId ? (stationName.get(device.stationId) ?? null) : null,
      tankName: device.tankId ? (tankName.get(device.tankId) ?? null) : null,
      vehicleName: device.vehicleId ? (vehicleName.get(device.vehicleId) ?? null) : null,
    }));
    return jsonOk({ rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("devices.create", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const serialNumber = maxLen(required(body.serialNumber, "Serial number"), 64, "Serial number");
    const typeValue = str(body.type, "fuel_probe");
    if (typeValue !== "fuel_probe" && typeValue !== "gps_tracker") {
      throw new ApiError(422, "Select a supported device type.", "validation_error");
    }
    const type = typeValue as "fuel_probe" | "gps_tracker";
    const orgId = ctx.user.organizationId;
    const stations = await listAllStations(orgId);
    const tanks = await listAllTanks(orgId);
    const vehicles = await listAllVehicles(orgId);
    const stationId = str(body.stationId);
    const tankId = str(body.tankId);
    const vehicleId = str(body.vehicleId);
    if (stationId && !stations.some((station) => station.id === stationId)) {
      throw new ApiError(422, "The selected station does not exist in your organization.", "validation_error");
    }
    if (stationId && !userCanAccessStation(ctx.user, stationId)) {
      throw new ApiError(403, "You are not scoped to the selected station.", "forbidden");
    }
    if (tankId && !tanks.some((tank) => tank.id === tankId)) {
      throw new ApiError(422, "The selected tank does not exist in your organization.", "validation_error");
    }
    if (vehicleId && !vehicles.some((vehicle) => vehicle.id === vehicleId)) {
      throw new ApiError(422, "The selected vehicle does not exist in your organization.", "validation_error");
    }
    const tank = tankId ? tanks.find((candidate) => candidate.id === tankId) : null;
    const vehicle = vehicleId ? vehicles.find((candidate) => candidate.id === vehicleId) : null;
    if (tankId && (!tank || !userCanAccessStation(ctx.user, tank.stationId))) {
      throw new ApiError(403, "You are not scoped to the selected tank's station.", "forbidden");
    }
    if (vehicleId && (!vehicle || !vehicle.stationId || !userCanAccessStation(ctx.user, vehicle.stationId))) {
      throw new ApiError(403, "You are not scoped to the selected vehicle's station.", "forbidden");
    }
    const assignedStationIds = [stationId || null, tank?.stationId ?? null, vehicle?.stationId ?? null]
      .filter((selectedId): selectedId is string => Boolean(selectedId));
    if (new Set(assignedStationIds).size > 1) {
      throw new ApiError(422, "The device and its assigned asset must belong to the same station.", "validation_error");
    }

    if (type === "fuel_probe") {
      if (!tankId) {
        throw new ApiError(422, "A fuel probe must be assigned to a tank.", "validation_error");
      }
    } else {
      const vehicleId = str(body.vehicleId);
      if (!vehicleId) {
        throw new ApiError(422, "A GPS tracker must be assigned to a vehicle.", "validation_error");
      }
    }

  // A device is useless without an ingest key, so one is minted here. Only the
  // SHA-256 hash is stored; the raw key is shown to the operator exactly once.
  const apiKey = newDeviceApiKey();
  let device!: Device;
  try {
    device = await transaction(async () => {
      if (type === "fuel_probe" && tankId) {
        const lockedTank = await lockTankForUpdate(tankId);
        if (!lockedTank || lockedTank.organizationId !== orgId || lockedTank.isArchived) {
          throw new ApiError(422, "Select an active tank in your organization.", "validation_error");
        }
        if (await hasActiveFuelProbe(tankId)) {
          throw new ApiError(409, `${lockedTank.name} already has an active fuel probe assigned.`, "conflict");
        }
      }
      return createDevice({
        organizationId: orgId,
        type,
        serialNumber,
        label: str(body.label) || null,
        provider: str(body.provider, "tectonic"),
        model: str(body.model) || null,
        firmware: str(body.firmware) || null,
        stationId: str(body.stationId) || null,
        tankId: str(body.tankId) || null,
        vehicleId: str(body.vehicleId) || null,
        apiKeyHash: hashDeviceKey(apiKey),
      });
    });
  } catch (error) {
    uniqueViolation(error, "A device with this serial number", "serial number");
  }
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "device",
      entityId: device.id,
      entityLabel: device.serialNumber,
      summary: `${ctx.user.name} registered device ${device.serialNumber}`,
      next: publicDevice(device),
      request,
    }));
    return jsonCreated({ ...publicDevice(device), apiKey });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
