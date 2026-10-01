import { hasOrganizationWideStationAccess, userCanAccessStation } from "@/server/auth/authorization";
import { getDevice, getVehicle } from "@/server/db/repo/devices";
import { getTank } from "@/server/db/repo/stations";
import type { SessionUser } from "@/server/auth/permissions";
import type { AlertRule } from "@/server/domain/types";

/**
 * Enforces the station boundary of an alert rule, including rules linked
 * indirectly through a tank or a device. Organization-wide rules are only
 * visible to organization-wide administrators.
 */
export async function userCanAccessAlertRule(user: SessionUser, rule: Partial<AlertRule>): Promise<boolean> {
  if (hasOrganizationWideStationAccess(user)) return true;
  if (rule.scope === "organization") return false;

  const stationIds: string[] = [];
  if (rule.stationId) stationIds.push(rule.stationId);

  if (rule.tankId) {
    const tank = await getTank(rule.tankId);
    if (!tank || tank.organizationId !== user.organizationId) return false;
    stationIds.push(tank.stationId);
  }

  if (rule.deviceId) {
    const device = await getDevice(rule.deviceId);
    if (!device || device.organizationId !== user.organizationId) return false;
    if (device.stationId) stationIds.push(device.stationId);
    if (device.tankId) {
      const tank = await getTank(device.tankId);
      if (!tank || tank.organizationId !== user.organizationId) return false;
      stationIds.push(tank.stationId);
    }
    if (device.vehicleId) {
      const vehicle = await getVehicle(device.vehicleId);
      if (!vehicle || vehicle.organizationId !== user.organizationId || !vehicle.stationId) return false;
      stationIds.push(vehicle.stationId);
    }
  }

  const uniqueStationIds = [...new Set(stationIds)];
  return uniqueStationIds.length > 0 && uniqueStationIds.every((stationId) => userCanAccessStation(user, stationId));
}
