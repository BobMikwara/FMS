import { hasOrganizationWideStationAccess, userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listAllDevices, listAllVehicles } from "@/server/db/repo/devices";
import { listAllTanks } from "@/server/db/repo/stations";
import { publicDevice } from "@/server/services/device-response";
import { PageHeader } from "@/components/ui/layout";
import { VehiclesBrowser } from "./vehicles-browser";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const vehicles = (await listAllVehicles(user.organizationId))
    .filter((vehicle) => hasOrganizationWideStationAccess(user) || userCanAccessStation(user, vehicle.stationId))
    .filter((vehicle) => !vehicle.isArchived);
  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const tankIds = new Set((await listAllTanks(user.organizationId))
    .filter((tank) => userCanAccessStation(user, tank.stationId))
    .map((tank) => tank.id));
  const devices = (await listAllDevices(user.organizationId)).filter((device) => {
    if (hasOrganizationWideStationAccess(user)) return true;
    return Boolean(device.vehicleId && vehicleIds.has(device.vehicleId)) &&
      (!device.stationId || userCanAccessStation(user, device.stationId)) &&
      (!device.tankId || tankIds.has(device.tankId)) &&
      (!device.vehicleId || vehicleIds.has(device.vehicleId));
  });
  const trackerByVehicle = new Map(
    devices.filter((device) => device.type === "gps_tracker" && device.vehicleId)
      .map((device) => [device.vehicleId, publicDevice(device)]),
  );

  const rows = vehicles.map((vehicle) => ({
    ...vehicle,
    tracker: trackerByVehicle.get(vehicle.id) ?? null,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicles"
        description="Tankers and bowsers used to move fuel between sites. Pair a GPS tracker to reconcile delivered volumes against dispatch records."
        actions={hasPermission(user, "vehicles.create") ? (
          <a href="/vehicles/new" className="btn btn-primary btn-sm">
            Add vehicle
          </a>
        ) : undefined}
      />
      <VehiclesBrowser
        initialRows={rows}
        canCreate={hasPermission(user, "vehicles.create")}
        canEdit={hasPermission(user, "vehicles.edit")}
        canArchive={hasPermission(user, "vehicles.delete")}
        canViewDevices={hasPermission(user, "devices.view")}
      />
    </div>
  );
}
