import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Navigation } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { buildDashboard } from "@/server/services/analytics";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { listAllVehicles } from "@/server/db/repo/devices";
import { PageHeader, Notice } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { NetworkMap, type MapStation, type MapVehicle } from "@/components/charts/map";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const dashboard = (await buildDashboard(user.organizationId, "7d", user.stationIds));
  const stations = (await listAllStations(user.organizationId));
  const tanks = (await listAllTanks(user.organizationId));
  const vehicles = (await listAllVehicles(user.organizationId));

  const stationSummary = new Map(dashboard.stations.map((entry) => [entry.station.id, entry]));

  const mapStations: MapStation[] = stations
    .filter((station) => Number.isFinite(station.latitude) && Number.isFinite(station.longitude))
    .map((station) => {
      const summary = stationSummary.get(station.id);
      const stationTanks = tanks.filter((tank) => tank.stationId === station.id);
      const capacity = stationTanks.reduce((sum, tank) => sum + tank.capacity, 0);
      const totalFuel = stationTanks.reduce((sum, tank) => sum + tank.currentVolume, 0);
      const activeAlerts = summary?.activeAlerts ?? 0;
      const status: MapStation["status"] = station.isArchived
        ? "archived"
        : station.status === "online"
          ? activeAlerts > 0
            ? "online"
            : "online"
          : station.status === "offline"
            ? "offline"
            : "maintenance";
      return {
        id: station.id,
        name: station.name,
        city: station.city,
        latitude: station.latitude,
        longitude: station.longitude,
        status,
        tankCount: stationTanks.length,
        totalFuel,
        capacity,
        activeAlerts,
        todayConsumption: summary?.todayConsumption ?? 0,
      };
    });

  const mapVehicles: MapVehicle[] = vehicles
    .filter((vehicle) => !vehicle.isArchived)
    .map((vehicle) => {
      const home = stations.find((station) => station.id === vehicle.stationId);
      return {
        id: vehicle.id,
        name: vehicle.name,
        plateNumber: vehicle.plateNumber,
        latitude: home?.latitude ?? null,
        longitude: home?.longitude ?? null,
        status: vehicle.status,
        lastSeenAt: null,
      };
    });

  const online = mapStations.filter((station) => station.status === "online").length;
  const withAlerts = mapStations.filter((station) => station.activeAlerts > 0).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Network map"
        description="Every station plotted by its coordinates. Marker size reflects tank capacity, the ring shows how full the site is, and a red badge counts active alerts."
        breadcrumbs={[{ label: "Stations" }, { label: "Map view" }]}
        actions={
          <Link href="/stations" className="btn btn-secondary btn-sm">
            <MapPin size={14} />
            All stations
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Stations plotted</p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">{mapStations.length}</p>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-2)]">{online} online</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Sites with active alerts</p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">{withAlerts}</p>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-2)]">Tap a marker to open the station</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Vehicles with a position</p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">
            {mapVehicles.filter((vehicle) => vehicle.latitude != null).length}
          </p>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-2)]">of {mapVehicles.length} tracked</p>
        </div>
      </div>

      <Notice tone="info" title="Positions come from the tracker, not the tank">
        Vehicle markers show the last known tracker position. When no position has been received the vehicle is shown at
        its home station with a clear “Not available” timestamp rather than a guessed location.
      </Notice>

      <NetworkMap stations={mapStations} vehicles={mapVehicles} height={480} />

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Stations</h2>
          <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
            Sorted by active alerts, then by name. Coordinates are stored on the station record.
          </p>
        </div>
        <ul className="divide-y divide-[var(--line)]">
          {[...mapStations]
            .sort((a, b) => b.activeAlerts - a.activeAlerts || a.name.localeCompare(b.name))
            .map((station) => (
              <li key={station.id}>
                <Link
                  href={`/stations/${station.id}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{station.name}</span>
                      <Badge
                        tone={station.status === "online" ? "ok" : station.status === "offline" ? "crit" : "warn"}
                      >
                        {station.status === "online" ? "Online" : station.status === "offline" ? "Offline" : "Maintenance"}
                      </Badge>
                      {station.activeAlerts > 0 ? <Badge tone="crit">{station.activeAlerts} active</Badge> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.75rem] text-[var(--ink-3)]">
                      {station.city} · {station.tankCount} tank{station.tankCount === 1 ? "" : "s"} ·{" "}
                      {Math.round(station.totalFuel).toLocaleString("en-US")} L of{" "}
                      {Math.round(station.capacity).toLocaleString("en-US")} L
                    </span>
                  </span>
                  <span className="text-num shrink-0 text-[0.6875rem] text-[var(--ink-3)]">
                    {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
                  </span>
                  <Navigation size={14} className="shrink-0 text-[var(--ink-3)]" />
                </Link>
              </li>
            ))}
        </ul>
      </section>

      {mapStations.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.875rem] font-medium text-[var(--ink)]">No stations with coordinates</p>
          <p className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Stations are plotted from their stored latitude and longitude. Add coordinates when creating a station, or edit
            an existing one to place it on the map.
          </p>
          <div className="mt-4">
            <Link href="/stations/new" className="btn btn-primary btn-sm">
              Add station
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
