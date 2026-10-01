import { hasOrganizationWideStationAccess, userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listAllDevices, listAllVehicles } from "@/server/db/repo/devices";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { DevicesBrowser } from "./devices-browser";
import { publicDevice } from "@/server/services/device-response";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const stations = (await listAllStations(user.organizationId)).filter(
    (station) => userCanAccessStation(user, station.id),
  );
  const tanks = (await listAllTanks(user.organizationId)).filter(
    (tank) => userCanAccessStation(user, tank.stationId),
  );
  const vehicles = new Map(
    (await listAllVehicles(user.organizationId))
      .filter((vehicle) => hasOrganizationWideStationAccess(user) || userCanAccessStation(user, vehicle.stationId))
      .map((vehicle) => [vehicle.id, `${vehicle.name} (${vehicle.plateNumber})`]),
  );
  const tankIds = new Set(tanks.map((tank) => tank.id));
  const devices = (await listAllDevices(user.organizationId)).filter((device) => {
    if (hasOrganizationWideStationAccess(user)) return true;
    const hasAllowedStation = userCanAccessStation(user, device.stationId) ||
      Boolean(device.tankId && tankIds.has(device.tankId)) ||
      Boolean(device.vehicleId && vehicles.has(device.vehicleId));
    const allAssignmentsAllowed =
      (!device.stationId || userCanAccessStation(user, device.stationId)) &&
      (!device.tankId || tankIds.has(device.tankId)) &&
      (!device.vehicleId || vehicles.has(device.vehicleId));
    return hasAllowedStation && allAssignmentsAllowed;
  });
  const stationName = new Map(stations.map((station) => [station.id, station.name]));
  const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));

  const rows = devices.map((device) => ({
    ...publicDevice(device),
    stationName: device.stationId ? (stationName.get(device.stationId) ?? null) : null,
    tankName: device.tankId ? (tankName.get(device.tankId) ?? null) : null,
    vehicleName: device.vehicleId ? (vehicles.get(device.vehicleId) ?? null) : null,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Devices"
        description="Fuel probes and GPS trackers. Each device authenticates with its own API key and normalises its vendor payload before it reaches the engine."
        actions={hasPermission(user, "devices.create") ? (
          <a href="/devices/new" className="btn btn-primary btn-sm">
            Register device
          </a>
        ) : undefined}
      />
      <DevicesBrowser
        initialRows={rows}
        canCreate={hasPermission(user, "devices.create")}
        canEdit={hasPermission(user, "devices.edit")}
        canRetire={hasPermission(user, "devices.delete")}
      />
    </div>
  );
}
