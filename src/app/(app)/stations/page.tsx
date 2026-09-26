import { getCurrentUser } from "@/server/auth/session";
import { listAllStations } from "@/server/db/repo/stations";
import { buildStationDetail } from "@/server/services/analytics";
import { PageHeader } from "@/components/ui/layout";
import { StationsBrowser } from "./stations-browser";

export const dynamic = "force-dynamic";

export default async function StationsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const allStations = await listAllStations(user.organizationId);
  const stations = allStations
    .filter((station) => user.stationIds.length === 0 || user.stationIds.includes(station.id))
    .filter((station) => !station.isArchived);
  const rows = await Promise.all(stations.map(async (station) => {
    const detail = (await buildStationDetail(station.id, "today"));
    return {
      id: station.id,
      name: station.name,
      code: station.code,
      city: station.city,
      region: station.region,
      country: station.country,
      address: station.address,
      status: station.status,
      latitude: station.latitude,
      longitude: station.longitude,
      openingTime: station.openingTime,
      closingTime: station.closingTime,
      tankCount: detail?.tanks.length ?? 0,
      totalFuel: Math.round(detail?.totalFuel ?? 0),
      capacity: Math.round(detail?.capacity ?? 0),
      utilizationPct: Number((detail?.utilizationPct ?? 0).toFixed(1)),
      todayConsumption: detail?.todayConsumption ?? 0,
      todayRefills: detail?.todayRefills ?? 0,
      activeAlerts: (detail?.alerts ?? []).filter((alert) => alert.status === "active").length,
      offlineDevices: (detail?.devices ?? []).filter((device) => device.status === "offline").length,
      totalDevices: (detail?.devices ?? []).length,
      createdAt: station.createdAt,
    };
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stations"
        description="Every fuel site in your network. Each station groups tanks, devices, vehicles and the people who operate them."
        actions={
          <a href="/stations/new" className="btn btn-primary btn-sm">
            Add station
          </a>
        }
      />
      <StationsBrowser initialRows={rows} canCreate />
    </div>
  );
}
