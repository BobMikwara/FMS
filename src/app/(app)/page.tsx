import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { buildDashboard } from "@/server/services/analytics";
import { PageHeader, StatCard } from "@/components/ui/layout";
import { Badge, EmptyState, LiveIndicator } from "@/components/ui/feedback";
import { deviceStatusLabel, deviceStatusTone, stationStatusTone, stationStatusLabel, tankStatusTone, tankStatusLabel } from "@/lib/status";
import { AreaChart, BarChart, ComparisonBars, type Series } from "@/components/charts/charts";
import { TankBar } from "@/components/charts/tank-visual";
import { Icon } from "@/components/layout/icons";
import { cn, formatDateTime, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { EventTypeBadge, StationStatusBadge, StatusBadge } from "@/components/domain/badges";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const data = (await buildDashboard(user.organizationId, "7d", user.stationIds));
  const { kpis, charts, alerts, recentMovements, lowTanks, deviceHealth, stations } = data;

  const greeting = greetingForHour(new Date().getHours());
  const firstName = user.name.split(" ")[0] ?? user.name;
  // Kept in step with the read-model's window so a KPI label can never claim a
  // period the number was not calculated over.
  const rangeLabel = { today: "day", "7d": "7 days", "30d": "30 days", "90d": "90 days" }[data.period] ?? "7 days";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={`${data.orgName} · live fuel inventory across ${kpis.totalStations} stations and ${kpis.totalTanks} tanks. Values below come directly from device readings - nothing here is estimated.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveIndicator state="live" ageLabel={timeAgo(data.generatedAt)} />
            <span className="hidden text-[0.75rem] text-[var(--ink-3)] sm:inline">{formatDateTime(data.generatedAt)}</span>
            <Link href="/reports/new" className="btn btn-secondary btn-sm">
              <Icon name="report" className="h-3.5 w-3.5" />
              New report
            </Link>
            <Link href="/stations/new" className="btn btn-primary btn-sm">
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add station
            </Link>
          </div>
        }
      />

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total stations"
          value={kpis.totalStations}
          icon={<Icon name="station" className="h-3.5 w-3.5" />}
          tone="brand"
          hint={
            <>
              <span className="text-[var(--ok)]">{kpis.onlineStations} online</span>
              {kpis.offlineStations > 0 ? (
                <>
                  {" · "}
                  <span className="text-[var(--crit)]">{kpis.offlineStations} offline</span>
                </>
              ) : null}
            </>
          }
          href="/stations"
        />
        <StatCard
          label="Total fuel available"
          value={formatNumber(Math.round(kpis.totalFuel))}
          unit="L"
          icon={<Icon name="fuel" className="h-3.5 w-3.5" />}
          tone="neutral"
          hint={`${formatPercent(kpis.averageLevelPct, 1)} of ${formatNumber(Math.round(kpis.totalCapacity))} L usable capacity`}
        />
        <StatCard
          label="Fuel consumption / tank outflow (today)"
          value={formatNumber(kpis.todayConsumption)}
          unit="L"
          icon={<Icon name="consumption" className="h-3.5 w-3.5" />}
          tone="info"
          hint="Derived from consecutive probe readings, not dispenser totals."
        />
        <StatCard
          label="Refills (today)"
          value={formatNumber(kpis.todayRefills)}
          unit="L"
          icon={<Icon name="refuel" className="h-3.5 w-3.5" />}
          tone="ok"
          hint={`${kpis.refillCount} refill event${kpis.refillCount === 1 ? "" : "s"} detected`}
        />
        <StatCard
          label="Active alerts"
          value={kpis.activeAlerts}
          icon={<Icon name="alert" className="h-3.5 w-3.5" />}
          tone={kpis.criticalAlerts > 0 ? "crit" : kpis.warningAlerts > 0 ? "warn" : "ok"}
          hint={
            <>
              {kpis.criticalAlerts} critical · {kpis.warningAlerts} warning
            </>
          }
          href="/alerts"
        />
        <StatCard
          label="Tanks needing attention"
          value={kpis.lowFuelTanks + kpis.criticalFuelTanks}
          icon={<Icon name="tank" className="h-3.5 w-3.5" />}
          tone={kpis.criticalFuelTanks > 0 ? "crit" : kpis.lowFuelTanks > 0 ? "warn" : "ok"}
          hint={`${kpis.criticalFuelTanks} critical · ${kpis.lowFuelTanks} low`}
          href="/tanks?low=true"
        />
        <StatCard
          label="Devices not reporting"
          value={kpis.offlineDevices}
          icon={<Icon name="device" className="h-3.5 w-3.5" />}
          tone={kpis.offlineDevices > 0 ? "warn" : "ok"}
          hint={`${kpis.connectedDevices} of ${kpis.totalDevices} fuel probes reporting`}
          href="/devices?type=fuel_probe&reporting=problem"
        />
        <StatCard
          label="Suspected loss"
          value={formatNumber(Math.round(kpis.suspectedLoss))}
          unit="L"
          icon={<Icon name="gauge" className="h-3.5 w-3.5" />}
          tone={kpis.suspectedLoss > 0 ? "warn" : "neutral"}
          hint={`Anomalous outflow over the selected ${rangeLabel} - flagged for investigation, never auto-classified as theft.`}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Fuel inventory trend</h2>
              <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
                Average measured volume per day across every tank in the network.
              </p>
            </div>
            <Badge tone="neutral">Last 7 days</Badge>
          </div>
          <div className="mt-4">
            {charts.levelTrend.length > 1 ? (
              <AreaChart
                labels={charts.levelTrend.map((point) => point.bucket)}
                series={
                  [
                    {
                      key: "volume",
                      label: "Measured volume",
                      color: "#0f766e",
                      values: charts.levelTrend.map((point) => Math.round(point.avgVolume)),
                    },
                  ] satisfies Series[]
                }
                height={260}
                yUnit="L"
                ariaLabel="Average measured fuel volume per day"
              />
            ) : (
              <EmptyState
                icon="tank"
                title="Not enough history yet"
                description="The inventory trend appears once the network has a few days of readings."
              />
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Consumption vs refills</h2>
              <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">Daily tank outflow against recorded refills.</p>
            </div>
          </div>
          <div className="mt-4">
            {charts.consumptionTrend.length > 0 ? (
              <BarChart
                labels={charts.consumptionTrend.map((point) => point.bucket)}
                series={[
                  {
                    key: "consumption",
                    label: "Tank outflow",
                    color: "#0f766e",
                    values: charts.consumptionTrend.map((point) => Math.round(point.consumption)),
                  },
                  {
                    key: "refills",
                    label: "Refills",
                    color: "#22c55e",
                    values: charts.consumptionTrend.map((point) => Math.round(point.refills)),
                  },
                ]}
                height={260}
                yUnit="L"
                ariaLabel="Daily consumption against refills"
              />
            ) : (
              <EmptyState
                icon="movement"
                title="No movement data yet"
                description="Once readings show sustained changes, daily outflow and refills are charted here."
              />
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Tanks requiring attention</h2>
              <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
                Ordered by how close each tank is to its critical threshold.
              </p>
            </div>
            <Link href="/tanks?low=true" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {lowTanks.length === 0 ? (
              <EmptyState
                icon="tank"
                title="All tanks are healthy"
                description="No tank is below its low threshold. Great time to review delivery schedules."
              />
            ) : (
              lowTanks.slice(0, 6).map((tank) => {
                const percent = tank.capacity > 0 ? (tank.currentVolume / tank.capacity) * 100 : 0;
                return (
                  <div key={tank.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/tanks/${tank.id}`} className="block truncate text-[0.8125rem] font-medium text-[var(--ink)] hover:underline">
                        {tank.name}
                      </Link>
                      <p className="mt-0.5 text-[0.75rem] text-[var(--ink-2)] text-num">
                        {formatNumber(Math.round(tank.currentVolume))} / {formatNumber(Math.round(tank.capacity))} L ·{" "}
                        {formatPercent(percent, 1)}
                      </p>
                    </div>
                    <StatusBadge tone={tankStatusTone(tank.status)}>{tankStatusLabel(tank.status)}</StatusBadge>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Station comparison</h2>
              <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">Fuel on hand relative to usable capacity.</p>
            </div>
            <Link href="/stations" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          <div className="mt-4">
            {charts.stationComparison.length === 0 ? (
              <EmptyState
                icon="station"
                title="No stations yet"
                description="Add your first station to start monitoring fuel inventory."
                action={
                  <Link href="/stations/new" className="btn btn-primary btn-sm">
                    Add station
                  </Link>
                }
              />
            ) : (
              <ComparisonBars
                items={charts.stationComparison.slice(0, 7).map((station) => ({
                  label: `${station.name} · ${formatNumber(Math.round(station.fuel))} L`,
                  value: Math.round(station.fuel),
                  max: Math.round(station.capacity),
                  meta: `${formatPercent(station.capacity > 0 ? (station.fuel / station.capacity) * 100 : 0, 0)} full`,
                }))}
                ariaLabel="Fuel on hand by station"
              />
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Recent fuel movement</h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                Refills and tank outflow detected from consecutive readings.
              </p>
            </div>
            <Link href="/movements" className="btn btn-ghost btn-sm">
              Open ledger
            </Link>
          </div>
          {recentMovements.length === 0 ? (
            <EmptyState
              icon="movement"
              title="No movements recorded yet"
              description="Refills and consumption appear here automatically once a tank reports a sustained level change."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentMovements.slice(0, 7).map((movement) => (
                <li key={movement.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
                      style={{
                        background: movement.type === "refill" ? "var(--ok-soft)" : "var(--info-soft)",
                        color: movement.type === "refill" ? "var(--ok)" : "var(--info)",
                      }}
                    >
                      <Icon name={movement.type === "refill" ? "refuel" : "consumption"} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">
                        {movement.tankName} · {movement.stationName}
                      </p>
                      <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                        {timeAgo(movement.ts)} · <EventTypeBadge type={movement.type} />
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "flex-none text-[0.8125rem] font-semibold text-num",
                      movement.type === "refill" ? "text-[var(--ok)]" : "text-[var(--ink)]",
                    )}
                  >
                    {movement.type === "refill" ? "+" : "−"}
                    {formatNumber(Math.round(movement.volume))} L
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Active alerts</h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">Acknowledge to take ownership, resolve with a note.</p>
            </div>
            <Link href="/alerts" className="btn btn-ghost btn-sm">
              View all
            </Link>
          </div>
          {alerts.length === 0 ? (
            <EmptyState
              icon="alert"
              title="No active alerts"
              description="Every tank is within its configured thresholds. Alert rules can be tuned at any time."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {alerts.slice(0, 6).map((alert) => (
                <li key={alert.id}>
                  <Link href="/alerts" className="flex items-start justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--surface-2)]">
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{alert.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{alert.message}</p>
                      <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)]">{timeAgo(alert.createdAt)}</p>
                    </div>
                    <Badge tone={alert.severity === "critical" ? "crit" : alert.severity === "warning" ? "warn" : "info"}>
                      {alert.severity}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Device health</h2>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
            Last seen time for each connected probe. Offline devices keep their last valid reading.
          </p>
          <div className="mt-4 space-y-2">
            {deviceHealth.length === 0 ? (
              <EmptyState
                icon="device"
                title="No devices connected"
                description="Register a fuel probe to start collecting measurements."
                action={
                  <Link href="/devices/new" className="btn btn-primary btn-sm">
                    Register device
                  </Link>
                }
              />
            ) : (
              deviceHealth.slice(0, 6).map((device) => (
                <div key={device.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{device.serialNumber}</p>
                    <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                      {device.provider} · {device.lastSeenAt ? `seen ${timeAgo(device.lastSeenAt)}` : "never connected"}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      device.status === "online"
                        ? "ok"
                        : device.status === "delayed"
                          ? "warn"
                          : device.status === "never_connected"
                            ? "neutral"
                            : "crit"
                    }
                  >
                    {device.status.replace("_", " ")}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Tank fill levels</h2>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
            Every monitored tank, most critical first. Tap a tank for its full history.
          </p>
          <div className="mt-4 space-y-1.5">
            {charts.tankLevels.length === 0 ? (
              <EmptyState
                icon="tank"
                title="No tanks have been added yet"
                description="Tanks hold the probe readings that drive every metric on this dashboard."
                action={
                  <Link href="/tanks/new" className="btn btn-primary btn-sm">
                    Add tank
                  </Link>
                }
              />
            ) : (
              charts.tankLevels.slice(0, 8).map((tank) => (
                <TankBar
                  key={tank.name}
                  name={tank.name}
                  color={tank.color}
                  volume={tank.volume}
                  capacity={tank.capacity}
                  href="/tanks"
                />
              ))
            )}
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">Stations</h2>
            <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">Inventory and today's movement for each site.</p>
          </div>
          <Link href="/stations" className="btn btn-secondary btn-sm">
            Manage stations
          </Link>
        </div>
        {stations.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon="station"
              title="No stations have been added yet"
              description="Stations group your tanks, devices and users. Add your first station to begin monitoring."
              action={
                <Link href="/stations/new" className="btn btn-primary btn-sm">
                  Add station
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stations.slice(0, 6).map((station) => (
              <li key={station.station.id}>
                <Link
                  href={`/stations/${station.station.id}`}
                  className="block rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-3)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{station.station.name}</p>
                    <StatusBadge
                      tone={
                        station.status === "online"
                          ? "ok"
                          : station.status === "warning"
                            ? "warn"
                            : station.status === "critical"
                              ? "crit"
                              : "neutral"
                      }
                    >
                      {station.station.status}
                    </StatusBadge>
                  </div>
                  <p className="mt-1.5 text-[0.75rem] text-[var(--ink-3)] text-num">
                    {station.tankCount} tanks · {formatNumber(Math.round(station.totalFuel))} L on hand
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)] text-num">
                    Outflow today {formatNumber(Math.round(station.todayConsumption))} L
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
