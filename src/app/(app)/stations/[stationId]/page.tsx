import { notFound } from "next/navigation";
import Link from "next/link";
import { getStation } from "@/server/db/repo/stations";
import { buildStationDetail } from "@/server/services/analytics";
import { getCurrentUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/layout";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { AreaChart, BarChart, ComparisonBars, type Series } from "@/components/charts/charts";
import { StationStatusBadge } from "@/components/domain/badges";
import { formatDateTime, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { Icon } from "@/components/layout/icons";
import { StationTanks } from "./station-tanks";

export const dynamic = "force-dynamic";

export default async function StationDetailPage({ params }: { params: Promise<{ stationId: string }> }) {
  const { stationId } = await params;
  const user = await getCurrentUser();
  if (!user) return null;
  const station = getStation(stationId);
  if (!station || station.organizationId !== user.organizationId) notFound();

  const detail = buildStationDetail(stationId, "7d");

  return (
    <div className="space-y-5">
      <PageHeader
        title={station.name}
        description={`${station.code} · ${station.address}, ${station.city}, ${station.region}, ${station.country} · Operating hours ${station.openingTime}–${station.closingTime}`}
        breadcrumbs={[{ label: "Stations", href: "/stations" }, { label: station.name }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StationStatusBadge status={station.status} />
            <a href={`/map?station=${station.id}`} className="btn btn-secondary btn-sm">
              <Icon name="map" className="h-3.5 w-3.5" />
              Show on map
            </a>
            <a href={`/stations/${station.id}/edit`} className="btn btn-secondary btn-sm">
              Edit
            </a>
          </div>
        }
      />

      {!detail ? (
        <EmptyState
          icon="station"
          title="No data for this station"
          description="This station has no tanks or readings yet. Add tanks and connect probes to start monitoring."
          action={
            <Link href="/tanks/new" className="btn btn-primary btn-sm">
              Add tank
            </Link>
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Tanks" value={String(detail.tanks.length)} hint={`${detail.fuelTypes.length} fuel types`} />
            <Metric
              label="Fuel on hand"
              value={`${formatNumber(Math.round(detail.totalFuel))} L`}
              hint={`${formatPercent(detail.utilizationPct, 1)} of ${formatNumber(Math.round(detail.capacity))} L capacity`}
            />
            <Metric
              label="Fuel consumption / tank outflow (today)"
              value={`${formatNumber(detail.todayConsumption)} L`}
              hint="Derived from consecutive probe readings"
            />
            <Metric label="Refills (today)" value={`${formatNumber(detail.todayRefills)} L`} hint="Detected from level increases" />
            <Metric
              label="Active alerts"
              value={String(detail.alerts.filter((alert) => alert.status === "active").length)}
              hint={`${detail.alerts.length} total on record`}
            />
            <Metric
              label="Devices reporting"
              value={`${detail.devices.filter((device) => device.status === "online").length}/${detail.devices.length}`}
              hint={`${detail.devices.filter((device) => device.status === "offline").length} offline`}
            />
            <Metric label="Outflow (7 days)" value={`${formatNumber(detail.rangeConsumption)} L`} hint="Across all tanks" />
            <Metric label="Suspected loss (7 days)" value={`${formatNumber(detail.rangeSuspectedLoss)} L`} hint="Flagged for investigation" />
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="card p-5">
              <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel level trend</h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">Average measured volume across this station's tanks.</p>
              <div className="mt-4">
                {detail.levelTrend.length > 1 ? (
                  <AreaChart
                    labels={detail.levelTrend.map((point) => point.bucket)}
                    series={
                      [
                        {
                          key: "volume",
                          label: "Measured volume",
                          color: "#0f766e",
                          values: detail.levelTrend.map((point) => Math.round(point.avgVolume)),
                        },
                      ] satisfies Series[]
                    }
                    height={220}
                    yUnit="L"
                    ariaLabel={`Fuel level trend for ${station.name}`}
                  />
                ) : (
                  <EmptyState
                    icon="tank"
                    title="Not enough history yet"
                    description="The trend appears once this station has a few days of readings."
                  />
                )}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Consumption vs refills</h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">Daily tank outflow against recorded refills.</p>
              <div className="mt-4">
                {detail.movementTrend.length > 0 ? (
                  <BarChart
                    labels={detail.movementTrend.map((point) => point.bucket)}
                    series={[
                      {
                        key: "consumption",
                        label: "Tank outflow",
                        color: "#0f766e",
                        values: detail.movementTrend.map((point) => Math.round(point.consumption)),
                      },
                      {
                        key: "refills",
                        label: "Refills",
                        color: "#22c55e",
                        values: detail.movementTrend.map((point) => Math.round(point.refills)),
                      },
                    ]}
                    height={220}
                    yUnit="L"
                    ariaLabel={`Consumption against refills for ${station.name}`}
                  />
                ) : (
                  <EmptyState
                    icon="movement"
                    title="No movement data yet"
                    description="Refills and outflow appear here once readings show sustained changes."
                  />
                )}
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Tank fill levels</h2>
            <div className="mt-4">
              <ComparisonBars
                items={detail.tanks.map((tank) => ({
                  label: `${tank.name} · ${formatNumber(Math.round(tank.currentVolume))} L`,
                  value: Math.round(tank.currentVolume),
                  max: Math.round(tank.capacity),
                  meta: `${formatPercent(tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0, 0)} full`,
                }))}
                ariaLabel={`Tank fill levels at ${station.name}`}
              />
            </div>
          </section>
        </>
      )}

      <StationTanks stationId={station.id} />

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Location</h2>
        <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
          Coordinates used by the network map: {station.latitude.toFixed(5)}, {station.longitude.toFixed(5)}
        </p>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
            <Icon name="location" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-medium text-[var(--ink)]">{station.address}</p>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {station.city}, {station.region} · {station.country}
              {station.phone ? ` · ${station.phone}` : ""}
            </p>
          </div>
        </div>
      </section>

      {detail && detail.movements.length > 0 ? (
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Recent movement at this station</h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">Refills and tank outflow detected across all tanks.</p>
            </div>
            <Link href="/movements" className="btn btn-ghost btn-sm">
              Open ledger
            </Link>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {detail.movements.map((movement) => {
              const tank = detail.tanks.find((row) => row.id === movement.tankId);
              return (
              <li key={movement.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{tank?.name ?? movement.tankId}</p>
                  <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                    {timeAgo(movement.ts)} · {formatDateTime(movement.ts)}
                  </p>
                </div>
                <Badge tone={movement.type === "refill" ? "ok" : movement.type === "anomaly" ? "warn" : "info"}>
                  {movement.type === "refill" ? "Refill" : movement.type === "anomaly" ? "Possible anomaly" : "Tank outflow"}
                </Badge>
                <span className="text-num flex-none text-[0.8125rem] font-semibold text-[var(--ink)]">
                  {movement.type === "refill" ? "+" : "−"}
                  {formatNumber(Math.round(movement.volume))} L
                </span>
              </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card kpi p-4">
      <p className="text-[0.75rem] font-medium text-[var(--ink-2)]">{label}</p>
      <p className="text-num mt-2 text-[1.375rem] font-semibold leading-none tracking-[-0.03em] text-[var(--ink)]">{value}</p>
      {hint ? <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">{hint}</p> : null}
    </div>
  );
}
