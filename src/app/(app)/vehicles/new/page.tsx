import { userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser } from "@/server/auth/session";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { listAllVehicles } from "@/server/db/repo/devices";
import { PageHeader } from "@/components/ui/layout";
import { VehicleForm } from "./vehicle-form";

export const dynamic = "force-dynamic";

export default async function NewVehiclePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const stations = (await listAllStations(user.organizationId))
    .filter((station) => userCanAccessStation(user, station.id))
    .filter((station) => !station.isArchived);
  const fuelTypes = (await listFuelTypes(user.organizationId, true));
  const vehicleCount = (await listAllVehicles(user.organizationId)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Add vehicle"
        description="Register a tanker, bowser or truck so GPS positions and delivered volumes can be reconciled."
      />
      <VehicleForm
        stations={stations.map((station) => ({ id: station.id, label: `${station.name} (${station.code})` }))}
        fuelTypes={fuelTypes.map((fuelType) => ({ id: fuelType.id, label: fuelType.displayName }))}
        vehicleCount={vehicleCount}
      />
    </div>
  );
}
