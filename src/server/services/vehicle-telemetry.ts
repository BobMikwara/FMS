import { execute, nowIso, query, transaction } from "../db/client";
import { getDevice, getVehicle, lockDeviceForUpdate, updateDevice } from "../db/repo/devices";
import { insertVehiclePosition } from "../db/repo/vehicle-positions";
import { getSettings } from "../db/repo/core";
import { resolveOperatorSettings } from "../domain/system-config";
import type { NormalizedVehiclePosition } from "../domain/types";

export type VehiclePositionIngestResult =
  | { ok: true; duplicate: true; positionId: string; vehicleId: string }
  | { ok: true; duplicate: false; positionId: string; vehicleId: string; latest: boolean }
  | { ok: false; rejected: "unknown_device" | "inactive_device" | "unassigned_device" | "invalid_position"; message: string };

function validPosition(position: NormalizedVehiclePosition): boolean {
  const timestamp = Date.parse(position.ts);
  return Boolean(
    Number.isFinite(timestamp) &&
    timestamp >= Date.UTC(2000, 0, 1) &&
    timestamp <= Date.now() + 5 * 60_000 &&
    Number.isFinite(position.latitude) && position.latitude >= -90 && position.latitude <= 90 &&
    Number.isFinite(position.longitude) && position.longitude >= -180 && position.longitude <= 180 &&
    (position.speedKph === null || (Number.isFinite(position.speedKph) && position.speedKph >= 0)) &&
    (position.headingDeg === null || (Number.isFinite(position.headingDeg) && position.headingDeg >= 0 && position.headingDeg < 360)) &&
    (position.odometerKm === null || (Number.isFinite(position.odometerKm) && position.odometerKm >= 0))
  );
}

/** Stores GPS fixes independently from tank readings, with per-device idempotency. */
export async function ingestVehiclePosition(
  deviceId: string,
  position: NormalizedVehiclePosition,
): Promise<VehiclePositionIngestResult> {
  if (!validPosition(position)) {
    return { ok: false, rejected: "invalid_position", message: "The GPS position failed timestamp or coordinate validation." };
  }

  return transaction(async () => {
    const foundDevice = await getDevice(deviceId);
    if (!foundDevice) {
      return { ok: false, rejected: "unknown_device", message: "Unrecognised GPS device." } as const;
    }
    await lockDeviceForUpdate(foundDevice.id);
    const device = await getDevice(foundDevice.id);
    if (!device) return { ok: false, rejected: "unknown_device", message: "Unrecognised GPS device." } as const;
    if (!device.isActive) {
      return { ok: false, rejected: "inactive_device", message: "This GPS tracker has been deactivated." } as const;
    }
    if (device.type !== "gps_tracker" || !device.vehicleId) {
      return { ok: false, rejected: "unassigned_device", message: "This GPS tracker must be assigned to a vehicle before it can submit positions." } as const;
    }

    const vehicle = await getVehicle(device.vehicleId);
    if (
      !vehicle || vehicle.organizationId !== device.organizationId || vehicle.isArchived ||
      (device.stationId && vehicle.stationId && device.stationId !== vehicle.stationId)
    ) {
      return { ok: false, rejected: "unassigned_device", message: "The GPS tracker is not assigned to an active vehicle in its organization." } as const;
    }

    const receivedAt = nowIso();
    const stored = await insertVehiclePosition({
      organizationId: device.organizationId,
      vehicleId: vehicle.id,
      deviceId: device.id,
      receivedAt,
      position,
    });
    if (!stored.inserted) {
      return { ok: true, duplicate: true, positionId: stored.position.id, vehicleId: vehicle.id } as const;
    }

    const incomingInstant = Date.parse(stored.position.ts);
    const previousInstant = device.lastSeenAt ? Date.parse(device.lastSeenAt) : Number.NEGATIVE_INFINITY;
    const latest = incomingInstant >= previousInstant;
    if (latest) {
      const settings = await getSettings(device.organizationId);
      const offlineTimeoutMin = resolveOperatorSettings(settings).offlineTimeoutMin;
      const fresh = incomingInstant <= Date.now() && Date.now() - incomingInstant <= offlineTimeoutMin * 60_000;
      const patch: Record<string, unknown> = {
        lastSeenAt: stored.position.ts,
        lastReadingAt: stored.position.ts,
      };
      if (fresh) patch.status = "online";
      if (position.signal !== null) patch.signalStrength = position.signal;
      if (position.batteryPct !== null) patch.batteryPct = position.batteryPct;
      await updateDevice(device.id, patch);

      if (fresh && device.status === "offline") {
        const offlineAlerts = await query<{ id: string }>(
          "SELECT id FROM alerts WHERE device_id = ? AND type = 'gps_offline' AND status != 'resolved'",
          [device.id],
        );
        for (const alert of offlineAlerts) {
          await execute(
            `UPDATE alerts SET status = 'resolved', resolved_at = ?, resolution_note = ?, updated_at = ? WHERE id = ? AND status != 'resolved'`,
            [receivedAt, "GPS telemetry restored", receivedAt, alert.id],
          );
        }
      }
    }

    if (position.odometerKm !== null) {
      await execute(
        `UPDATE vehicles SET odometer_km = ?, updated_at = ?
         WHERE id = ? AND (odometer_km IS NULL OR odometer_km <= ?)`,
        [position.odometerKm, receivedAt, vehicle.id, position.odometerKm],
      );
    }

    return {
      ok: true,
      duplicate: false,
      positionId: stored.position.id,
      vehicleId: vehicle.id,
      latest,
    } as const;
  });
}
