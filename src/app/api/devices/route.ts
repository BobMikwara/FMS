import type { Device } from "@/server/domain/types";
import { randomBytes } from "node:crypto";
import { createDevice, listDevices } from "@/server/db/repo/devices";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { listAllVehicles } from "@/server/db/repo/devices";
import { ApiError, audit, jsonCreated, jsonError, jsonOk, maxLen, parseJsonBody, parsePagination, required, str, withPermission,
  uniqueViolation,
} from "@/server/api/route";
import { hashDeviceKey } from "@/server/auth/session";

/** Generates a per-device ingest key. Returned to the caller exactly once. */
function newDeviceApiKey(): string {
  return `dkey_${randomBytes(24).toString("base64url")}`;
}

export const dynamic = "force-dynamic";

export const GET = withPermission("devices.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 24);
    const result = listDevices({
      orgId: ctx.user.organizationId,
      type: params.get("type") ?? undefined,
      status: params.get("status") ?? undefined,
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
    });
    const stations = listAllStations(ctx.user.organizationId);
    const tanks = listAllTanks(ctx.user.organizationId);
    const vehicles = listAllVehicles(ctx.user.organizationId);
    const stationName = new Map(stations.map((station) => [station.id, station.name]));
    const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));
    const vehicleName = new Map(vehicles.map((vehicle) => [vehicle.id, `${vehicle.name} (${vehicle.plateNumber})`]));
    const rows = result.rows.map((device) => ({
      ...device,
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
    const type = str(body.type, "fuel_probe") as "fuel_probe" | "gps_tracker";
    const orgId = ctx.user.organizationId;

    if (type === "fuel_probe") {
      const tankId = str(body.tankId);
      if (!tankId) {
        throw new ApiError(422, "A fuel probe must be assigned to a tank.", "validation_error");
      }
      const tanks = listAllTanks(orgId);
      const tank = tanks.find((row) => row.id === tankId);
      if (!tank) throw new ApiError(422, "The selected tank does not exist.", "validation_error");
      const devices = listDevices({ orgId, tankId, pageSize: 100 }).rows;
      if (devices.some((device) => device.type === "fuel_probe")) {
        throw new ApiError(409, `${tank.name} already has a fuel probe assigned.`, "conflict");
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
    device = createDevice({
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
  } catch (error) {
    uniqueViolation(error, "A device with this serial number", "serial number");
  }
    audit({
      user: ctx.user,
      action: "created",
      entity: "device",
      entityId: device.id,
      entityLabel: device.serialNumber,
      summary: `${ctx.user.name} registered device ${device.serialNumber}`,
      next: device,
      request,
    });
    return jsonCreated({ ...device, apiKey });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
