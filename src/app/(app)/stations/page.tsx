import { hasOrganizationWideStationAccess, userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
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
    .filter((station) => userCanAccessStation(user, station.id))
    .filter((station) => !station.isArchived);
  const canCreate = hasPermission(user, "stations.create") && hasOrganizationWideStationAccess(user);
  const canViewTanks = hasPermission(user, "tanks.view");
  const canViewMovements = hasPermission(user, "movements.view");
  const canViewAlerts = hasPermission(user, "alerts.view");
  const canViewDevices = hasPermission(user, "devices.view");
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
      isArchived: station.isArchived,
      latitude: station.latitude,
      longitude: station.longitude,
      openingTime: station.openingTime,
      closingTime: station.closingTime,
      tankCount: canViewTanks ? detail?.tanks.length ?? 0 : null,
      totalFuel: canViewTanks ? Math.round(detail?.totalFuel ?? 0) : null,
      capacity: canViewTanks ? Math.round(detail?.capacity ?? 0) : null,
      utilizationPct: canViewTanks ? Number((detail?.utilizationPct ?? 0).toFixed(1)) : null,
      todayConsumption: canViewMovements ? detail?.todayConsumption ?? 0 : null,
      todayRefills: canViewMovements ? detail?.todayRefills ?? 0 : null,
      activeAlerts: canViewAlerts ? (detail?.alerts ?? []).filter((alert) => alert.status === "active").length : null,
      offlineDevices: canViewDevices ? (detail?.devices ?? []).filter((device) => device.status === "offline").length : null,
      totalDevices: canViewDevices ? (detail?.devices ?? []).length : null,
      createdAt: station.createdAt,
    };
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stations"
        description="Every fuel site in your network. Each station groups tanks, devices, vehicles and the people who operate them."
        actions={canCreate ? (
          <a href="/stations/new" className="btn btn-primary btn-sm">
            Add station
          </a>
        ) : undefined}
      />
      <StationsBrowser
        initialRows={rows}
        canCreate={canCreate}
        canArchive={hasPermission(user, "stations.archive") || hasPermission(user, "stations.delete")}
        canViewTanks={canViewTanks}
        canViewMovements={canViewMovements}
        canViewAlerts={canViewAlerts}
        canViewDevices={canViewDevices}
      />
    </div>
  );
}
