import { getCurrentUser } from "@/server/auth/session";
import { getVehicle } from "@/server/db/repo/devices";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { listAllVehicles } from "@/server/db/repo/devices";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { VehicleForm } from "../../new/vehicle-form";

export const dynamic = "force-dynamic";

export default async function EditVehiclePage({ params }: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  const vehicle = (await getVehicle(vehicleId));
  if (!vehicle || vehicle.organizationId !== user.organizationId) notFound();

  const stations = (await listAllStations(user.organizationId)).filter((station) => !station.isArchived);
  const fuelTypes = (await listFuelTypes(user.organizationId));
  const vehicleCount = (await listAllVehicles(user.organizationId)).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Edit vehicle" description={`${vehicle.name} · ${vehicle.plateNumber}`} />
      <VehicleForm
        stations={stations.map((station) => ({ id: station.id, label: `${station.name} (${station.code})` }))}
        fuelTypes={fuelTypes.map((fuelType) => ({ id: fuelType.id, label: fuelType.displayName }))}
        vehicleCount={vehicleCount}
        vehicle={{
          id: vehicle.id,
          name: vehicle.name,
          plateNumber: vehicle.plateNumber,
          type: vehicle.type,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          fuelTypeId: vehicle.fuelTypeId,
          tankCapacity: vehicle.tankCapacity,
          stationId: vehicle.stationId,
          driverName: vehicle.driverName,
          driverPhone: vehicle.driverPhone,
          odometerKm: vehicle.odometerKm,
          notes: vehicle.notes,
        }}
      />
    </div>
  );
}
