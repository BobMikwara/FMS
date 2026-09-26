import { getCurrentUser } from "@/server/auth/session";
import { listAllDevices } from "@/server/db/repo/devices";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { DevicesBrowser } from "./devices-browser";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const devices = listAllDevices(user.organizationId);
  const stations = listAllStations(user.organizationId);
  const tanks = listAllTanks(user.organizationId);
  const vehicles = new Map<string, string>();
  const stationName = new Map(stations.map((station) => [station.id, station.name]));
  const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));

  const rows = devices.map((device) => ({
    ...device,
    stationName: device.stationId ? (stationName.get(device.stationId) ?? null) : null,
    tankName: device.tankId ? (tankName.get(device.tankId) ?? null) : null,
    vehicleName: device.vehicleId ? (vehicles.get(device.vehicleId) ?? null) : null,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Devices"
        description="Fuel probes and GPS trackers. Each device authenticates with its own API key and normalises its vendor payload before it reaches the engine."
        actions={
          <a href="/devices/new" className="btn btn-primary btn-sm">
            Register device
          </a>
        }
      />
      <DevicesBrowser initialRows={rows} />
    </div>
  );
}
