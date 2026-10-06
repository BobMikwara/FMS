import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasOrganizationWideStationAccess, userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getOrganization } from "@/server/db/repo/core";
import { getVehicle } from "@/server/db/repo/devices";
import { latestPositionForVehicle, listVehiclePositions } from "@/server/db/repo/vehicle-positions";
import { getStation } from "@/server/db/repo/stations";
import { resolveOperatorSettings } from "@/server/domain/system-config";
import { getSettings } from "@/server/db/repo/core";
import { telemetryFreshness } from "@/server/domain/device-freshness";
import { formatDateTimeInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { Badge } from "@/components/ui/feedback";
import { PageHeader, Notice } from "@/components/ui/layout";

export const dynamic = "force-dynamic";

function formatValue(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export default async function VehiclePositionHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { vehicleId } = await params;
  const query = await searchParams;
  const requestedPage = Math.max(1, Math.floor(Number(query.page ?? 1) || 1));
  const vehicle = await getVehicle(vehicleId);
  if (
    !vehicle ||
    vehicle.organizationId !== user.organizationId ||
    (!hasOrganizationWideStationAccess(user) && !userCanAccessStation(user, vehicle.stationId))
  ) notFound();
  if (!hasPermission(user, "vehicles.view")) redirect("/vehicles");

  const [station, organization, settings] = await Promise.all([
    vehicle.stationId ? getStation(vehicle.stationId) : Promise.resolve(null),
    getOrganization(user.organizationId),
    getSettings(user.organizationId),
  ]);
  const timeZone = normalizeTimeZone(station?.timezone ?? organization?.timezone);
  const canViewPositions = hasPermission(user, "devices.view");
  const latest = canViewPositions ? await latestPositionForVehicle(user.organizationId, vehicle.id) : null;
  const freshness = telemetryFreshness(latest?.ts, {
    liveWithinSeconds: Math.min(300, resolveOperatorSettings(settings).offlineTimeoutMin * 60),
    staleAfterSeconds: resolveOperatorSettings(settings).offlineTimeoutMin * 60,
  });
  const from = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const to = new Date().toISOString();
  const pageSize = 100;
  let history = canViewPositions
    ? await listVehiclePositions({ organizationId: user.organizationId, vehicleId: vehicle.id, from, to, page: requestedPage, pageSize })
    : { rows: [], total: 0 };
  const pageCount = Math.max(1, Math.ceil(history.total / pageSize));
  const currentPage = Math.min(requestedPage, pageCount);
  if (canViewPositions && currentPage !== requestedPage) {
    history = await listVehiclePositions({ organizationId: user.organizationId, vehicleId: vehicle.id, from, to, page: currentPage, pageSize });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${vehicle.name} position history`}
        description={`${vehicle.plateNumber} · ${vehicle.type} · timestamps shown in ${timeZone}.`}
        breadcrumbs={[{ label: "Vehicles", href: "/vehicles" }, { label: vehicle.name }, { label: "Position history" }]}
        actions={
          <div className="flex items-center gap-2">
            {hasPermission(user, "vehicles.edit") ? (
              <Link href={`/vehicles/${vehicle.id}/edit`} className="btn btn-secondary btn-sm">Edit vehicle</Link>
            ) : null}
            <Link href="/map" className="btn btn-secondary btn-sm">Network map</Link>
          </div>
        }
      />

      {!canViewPositions ? (
        <Notice tone="info" title="Device-view permission required">
          Vehicle details are available, but tracker coordinates and position history require device-view permission.
        </Notice>
      ) : (
        <>
          <section className="card grid gap-4 p-5 sm:grid-cols-4">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Latest position</p>
              <p className="mt-1 text-[0.8125rem] font-medium text-[var(--ink)]">
                {latest ? formatDateTimeInTimeZone(latest.ts, timeZone) : "No GPS fix recorded"}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{timeZone}</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Freshness</p>
              <div className="mt-1"><Badge tone={freshness === "live" ? "ok" : freshness === "delayed" ? "warn" : "neutral"}>{freshness}</Badge></div>
              <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">Only fresh positions appear as current map markers.</p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Coordinates</p>
              <p className="mt-1 text-num text-[0.8125rem] font-medium text-[var(--ink)]">
                {latest ? `${latest.latitude.toFixed(5)}, ${latest.longitude.toFixed(5)}` : "-"}
              </p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Speed / ignition</p>
              <p className="mt-1 text-[0.8125rem] font-medium text-[var(--ink)]">
                {latest?.speedKph == null ? "-" : `${formatValue(latest.speedKph)} km/h`} · {latest?.ignition == null ? "unknown" : latest.ignition ? "on" : "off"}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">Odometer {latest?.odometerKm == null ? "-" : `${formatValue(latest.odometerKm, 0)} km`}</p>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
              <div>
                <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">GPS history</h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">100 positions per page from the last 30 days · page {currentPage} of {pageCount} · {history.total} total in this period.</p>
              </div>
            </div>
            {history.rows.length === 0 ? (
              <div className="px-5 py-9 text-center">
                <p className="text-[0.875rem] font-medium text-[var(--ink)]">No position history yet</p>
                <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">Check that an active GPS tracker is paired with this vehicle and sending a supported payload.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-[0.75rem]">
                  <thead className="bg-[var(--surface-2)] text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Timestamp ({timeZone})</th>
                      <th className="px-5 py-2.5 font-medium">Latitude</th>
                      <th className="px-5 py-2.5 font-medium">Longitude</th>
                      <th className="px-5 py-2.5 font-medium">Speed</th>
                      <th className="px-5 py-2.5 font-medium">Ignition</th>
                      <th className="px-5 py-2.5 font-medium">Odometer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {history.rows.map((position) => (
                      <tr key={position.id}>
                        <td className="whitespace-nowrap px-5 py-2.5 text-[var(--ink-2)]">{formatDateTimeInTimeZone(position.ts, timeZone)}</td>
                        <td className="text-num px-5 py-2.5 text-[var(--ink)]">{position.latitude.toFixed(6)}</td>
                        <td className="text-num px-5 py-2.5 text-[var(--ink)]">{position.longitude.toFixed(6)}</td>
                        <td className="text-num px-5 py-2.5 text-[var(--ink-2)]">{position.speedKph == null ? "-" : `${formatValue(position.speedKph)} km/h`}</td>
                        <td className="px-5 py-2.5 text-[var(--ink-2)]">{position.ignition == null ? "-" : position.ignition ? "On" : "Off"}</td>
                        <td className="text-num px-5 py-2.5 text-[var(--ink-2)]">{position.odometerKm == null ? "-" : `${formatValue(position.odometerKm, 0)} km`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {history.total > 0 ? (
            <nav aria-label="GPS history pages" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[0.75rem] text-[var(--ink-3)]">Page {currentPage} of {pageCount}</p>
              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link href={`/vehicles/${vehicle.id}?page=${currentPage - 1}`} className="btn btn-secondary btn-sm">Previous</Link>
                ) : null}
                {currentPage < pageCount ? (
                  <Link href={`/vehicles/${vehicle.id}?page=${currentPage + 1}`} className="btn btn-secondary btn-sm">Next</Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
