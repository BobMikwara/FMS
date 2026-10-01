import { userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser } from "@/server/auth/session";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { TankForm } from "./tank-form";

export const dynamic = "force-dynamic";

export default async function NewTankPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const stations = (await listAllStations(user.organizationId))
    .filter((station) => userCanAccessStation(user, station.id))
    .filter((station) => !station.isArchived)
    .map((station) => ({ id: station.id, name: `${station.name} (${station.code})` }));
  const fuelTypes = (await listFuelTypes(user.organizationId, true)).map((fuelType) => ({
    id: fuelType.id,
    name: fuelType.displayName,
  }));

  return <TankForm stations={stations} fuelTypes={fuelTypes} />;
}
