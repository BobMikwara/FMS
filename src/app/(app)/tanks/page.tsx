import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { listAllStations, listAllTanks, listFuelTypes } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { TanksBrowser } from "./tanks-browser";

export const dynamic = "force-dynamic";

export default async function TanksPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const tanks = listAllTanks(user.organizationId).filter((tank) => !tank.isArchived);
  const stations = listAllStations(user.organizationId);
  const stationName = new Map(stations.map((station) => [station.id, station.name]));

  const rows = tanks.map((tank) => {
    const percent = tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0;
    return {
      id: tank.id,
      name: tank.name,
      code: tank.code,
      stationId: tank.stationId,
      stationName: stationName.get(tank.stationId) ?? "Unknown station",
      fuelTypeId: tank.fuelTypeId,
      capacity: tank.capacity,
      currentVolume: tank.currentVolume,
      levelPercent: Number(percent.toFixed(1)),
      status: tank.status,
      tankType: tank.tankType,
      lowThresholdPct: tank.lowThresholdPct,
      criticalThresholdPct: tank.criticalThresholdPct,
      overfillThresholdPct: tank.overfillThresholdPct,
      lastReadingAt: tank.lastReadingAt,
      currentTempC: tank.currentTempC,
      waterLevelMm: tank.waterLevelMm,
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tanks"
        description="Every monitored tank across your network, with measured volume, status and configured thresholds."
        actions={
          <Link href="/tanks/new" className="btn btn-primary btn-sm">
            Add tank
          </Link>
        }
      />
      <TanksBrowser
        initialRows={rows}
        stations={stations.map((station) => ({ id: station.id, name: station.name }))}
        fuelTypes={listFuelTypes(user.organizationId).map((fuelType) => ({
          id: fuelType.id,
          name: fuelType.displayName,
          color: fuelType.color,
          systemName: fuelType.systemName,
        }))}
      />
    </div>
  );
}
