import { notFound } from "next/navigation";
import Link from "next/link";
import { getTank, getStation } from "@/server/db/repo/stations";
import { buildTankDetail } from "@/server/services/analytics";
import { getCurrentUser } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/layout";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { TankVisual } from "@/components/charts/tank-visual";
import { TankDetailClient } from "./tank-detail-client";

export const dynamic = "force-dynamic";

export default async function TankDetailPage({ params }: { params: Promise<{ tankId: string }> }) {
  const { tankId } = await params;
  const user = await getCurrentUser();
  const tank = (await getTank(tankId));
  if (
    !tank ||
    !user ||
    tank.organizationId !== user.organizationId ||
    (user.stationIds.length > 0 && !user.stationIds.includes(tank.stationId))
  ) notFound();

  const station = (await getStation(tank.stationId));
  const data = (await buildTankDetail(tankId));

  return (
    <div className="space-y-5">
      <PageHeader
        title={tank.name}
        description={`${tank.code} · ${station?.name ?? "Unknown station"} · ${
          tank.tankType === "underground" ? "Underground" : "Above ground"
        } tank`}
        breadcrumbs={[
          { label: "Stations", href: "/stations" },
          { label: station?.name ?? "Station", href: `/stations/${tank.stationId}` },
          { label: tank.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{Math.round(tank.capacity).toLocaleString()} L capacity</Badge>
            <Badge tone="info">
              Low {tank.lowThresholdPct}% · Critical {tank.criticalThresholdPct}% · Overfill {tank.overfillThresholdPct}%
            </Badge>
            <Link href={`/stations/${tank.stationId}`} className="btn btn-secondary btn-sm">
              Station overview
            </Link>
          </div>
        }
      />

      {!data ? (
        <EmptyState
          icon="tank"
          title="No readings available yet"
          description={`${tank.name} has not reported any probe readings, so no volume, temperature or water data can be shown. This is expected for a newly installed tank — readings will appear as soon as the device connects.`}
          action={
            <Link href="/devices" className="btn btn-primary">
              Check device status
            </Link>
          }
        />
      ) : (
        <TankDetailClient
          // `node:sqlite` returns rows with a null prototype, which cannot cross
          // the server/client boundary — round-trip through JSON first.
          {...(JSON.parse(JSON.stringify({ tank: data.tank, station: data.station, fuelType: data.fuelType, device: data.device })) as {
            tank: typeof data.tank;
            station: typeof data.station;
            fuelType: typeof data.fuelType;
            device: typeof data.device;
          })}
          detail={JSON.parse(JSON.stringify({
            fillPercent: data.fillPercent,
            remainingCapacity: data.remainingCapacity,
            status: data.status,
            dataState: data.dataState,
            lastUpdateAgeMinutes: data.lastUpdateAgeMinutes,
            todayConsumption: data.todayConsumption,
            todayRefills: data.todayRefills,
            coverage: data.coverage,
            reconciliation: data.reconciliation,
            history: data.history,
            events: data.events.slice(0, 20),
            alerts: data.alerts.slice(0, 10),
            readings: data.readings.slice(0, 20),
            latestReading: data.latestReading,
          }))}
        />
      )}

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Tank state reference</h2>
        <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
          States are calculated from measured probe volume and this tank's configured thresholds.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Full", range: "85 – 100%", tone: "ok" as const },
            { label: "Normal", range: "30 – 84%", tone: "info" as const },
            { label: "Low", range: `15 – ${Math.max(14, tank.lowThresholdPct - 1)}%`, tone: "warn" as const },
            { label: "Critical", range: `< ${tank.criticalThresholdPct}%`, tone: "crit" as const },
          ].map((row) => (
            <div key={row.label} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.75rem] font-medium text-[var(--ink)]">{row.label}</span>
                <Badge tone={row.tone}>{row.range}</Badge>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Underground tank</h2>
        <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
          Measured volume divided by usable capacity. The liquid level animates smoothly as new readings arrive.
        </p>
        <div className="mt-5 flex justify-center">
          <TankVisual
            name={tank.name}
            fuelType={fuelTypeName(data)}
            color={fuelTypeColor(data)}
            volume={data?.tank.currentVolume ?? 0}
            capacity={tank.capacity}
            status={data?.status ?? "normal"}
            dataState={data?.dataState ?? "offline"}
            size="lg"
            showHeader={false}
          />
        </div>
      </section>
    </div>
  );
}

function fuelTypeName(data: Awaited<ReturnType<typeof buildTankDetail>>) {
  return data?.fuelType?.systemName ?? "fuel";
}

function fuelTypeColor(data: Awaited<ReturnType<typeof buildTankDetail>>) {
  return data?.fuelType?.color ?? "#0f766e";
}

function fuelTypeLabel(data: Awaited<ReturnType<typeof buildTankDetail>>) {
  return data?.fuelType?.displayName;
}
