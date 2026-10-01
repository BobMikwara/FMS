import { stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser } from "@/server/auth/session";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { listAllVehicles } from "@/server/db/repo/devices";
import { listDevices } from "@/server/db/repo/devices";
import { listFuelTypes } from "@/server/db/repo/stations";
import { listProviderInfo } from "@/server/integrations/providers";
import { PageHeader } from "@/components/ui/layout";
import { DeviceForm, type ProviderOption } from "./device-form";

export const dynamic = "force-dynamic";

export default async function NewDevicePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const orgId = user.organizationId;
  const stations = (await listAllStations(orgId)).filter(
    (station) => userCanAccessStation(user, station.id),
  );
  const tanks = (await listAllTanks(orgId)).filter(
    (tank) => userCanAccessStation(user, tank.stationId),
  );
  const vehicles = (await listAllVehicles(orgId)).filter(
    (vehicle) => userCanAccessStation(user, vehicle.stationId),
  );
  const fuelTypes = (await listFuelTypes(orgId));

  // A tank can only have one probe, so tanks that already have one are excluded.
  const probes = (await listDevices({ orgId, type: "fuel_probe", pageSize: 500, stationIds: stationScopeForUser(user) })).rows;
  const probedTanks = new Set(probes.map((device) => device.tankId));
  const fuelLabel = new Map(fuelTypes.map((fuelType) => [fuelType.id, fuelType.displayName]));
  const stationLabel = new Map(stations.map((station) => [station.id, station.name]));

  const availableTanks = tanks
    .filter((tank) => !probedTanks.has(tank.id) && !tank.isArchived)
    .map((tank) => ({
      id: tank.id,
      label: `${stationLabel.get(tank.stationId) ?? "Station"} · ${tank.name}${
        tank.fuelTypeId ? ` (${fuelLabel.get(tank.fuelTypeId) ?? "fuel"})` : ""
      }`,
      stationId: tank.stationId,
    }));

  const providers = listProviderInfo() as ProviderOption[];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Register device"
        description="A device gets its own ingest API key, which is shown once and stored only as a hash."
      />
      <DeviceForm
        providers={providers}
        stations={stations
          .filter((station) => !station.isArchived)
          .map((station) => ({ id: station.id, label: `${station.name} (${station.code})` }))}
        tanks={availableTanks}
        vehicles={vehicles.map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.name} · ${vehicle.plateNumber}`,
        }))}
        defaultStationId={null}
      />
    </div>
  );
}
