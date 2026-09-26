import { randomBytes } from "node:crypto";
import { deleteDevice, getDevice, updateDevice } from "@/server/db/repo/devices";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";
import { hashDeviceKey } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export const GET = withPermission("devices.view", async (request, ctx) => {
  try {
    const device = getDevice(ctx.params?.deviceId ?? "");
    if (!device || device.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    return jsonOk(device);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("devices.edit", async (request, ctx) => {
  try {
    const deviceId = ctx.params?.deviceId ?? "";
    const existing = getDevice(deviceId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["label", "provider", "model", "firmware", "stationId", "tankId", "vehicleId", "status", "isActive"]) {
      if (body[key] !== undefined) patch[key] = body[key];
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
    const device = updateDevice(deviceId, patch);
    if (!device) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "device",
      entityId: device.id,
      entityLabel: device.serialNumber,
      summary: `${ctx.user.name} ${rotatedApiKey ? "rotated the ingest key for" : "updated"} device ${device.serialNumber}`,
      previous: existing,
      next: device,
      request,
    });
    // The raw key is returned exactly once; only its hash is ever stored.
    return jsonOk(rotatedApiKey ? { ...device, apiKey: rotatedApiKey } : device);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("devices.delete", async (request, ctx) => {
  try {
    const deviceId = ctx.params?.deviceId ?? "";
    const existing = getDevice(deviceId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    // Devices keep their reading history, so the default is a soft retire.
    const hard = new URL(request.url).searchParams.get("hard") === "true";
    if (hard) deleteDevice(deviceId);
    else updateDevice(deviceId, { isActive: false, status: "offline" });
    audit({
      user: ctx.user,
      action: hard ? "deleted" : "retired",
      entity: "device",
      entityId: existing.id,
      entityLabel: existing.serialNumber,
      summary: `${ctx.user.name} ${hard ? "deleted" : "retired"} device ${existing.serialNumber}`,
      previous: existing,
      request,
    });
    return jsonOk({ id: deviceId, deleted: hard });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
