import { getCurrentUser } from "@/server/auth/session";
import { listAllVehicles } from "@/server/db/repo/devices";
import { listAllDevices } from "@/server/db/repo/devices";
import { PageHeader } from "@/components/ui/layout";
import { VehiclesBrowser } from "./vehicles-browser";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const vehicles = listAllVehicles(user.organizationId).filter((vehicle) => !vehicle.isArchived);
  const devices = listAllDevices(user.organizationId);
  const trackerByVehicle = new Map(
    devices.filter((device) => device.type === "gps_tracker" && device.vehicleId).map((device) => [device.vehicleId, device]),
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
        actions={
          <a href="/vehicles/new" className="btn btn-primary btn-sm">
            Add vehicle
          </a>
        }
      />
      <VehiclesBrowser initialRows={rows} />
    </div>
  );
}
