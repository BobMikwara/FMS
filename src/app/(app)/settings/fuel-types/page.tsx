import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listFuelTypes, listAllTanks } from "@/server/db/repo/stations";
import { PageHeader, Notice } from "@/components/ui/layout";
import { FuelTypesBrowser } from "./fuel-types-browser";

export const dynamic = "force-dynamic";

export default async function FuelTypesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const fuelTypes = (await listFuelTypes(user.organizationId));
  const tanks = (await listAllTanks(user.organizationId));

  const rows = fuelTypes.map((fuel) => ({
    id: fuel.id,
    systemName: fuel.systemName,
    displayName: fuel.displayName,
    color: fuel.color,
    density: fuel.density,
    isActive: fuel.isActive,
    createdAt: fuel.createdAt,
    tankCount: tanks.filter((tank) => tank.fuelTypeId === fuel.id).length,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fuel types"
        description="The products stored in your tanks. Density is used to convert probe height into volume, so it must match the certificate of analysis your supplier provides."
        breadcrumbs={[{ label: "Settings" }, { label: "Fuel types" }]}
      />

      <Notice tone="info" title="Deleting a fuel type">
        A fuel type in use by a tank cannot be deleted - reassign or archive those tanks first. This protects the movement
        ledger from losing its meaning.
      </Notice>

      <FuelTypesBrowser initialRows={rows} />
    </div>
  );
}
