import { stationScopeForUser } from "@/server/auth/authorization";
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { listEvents, movementTotals } from "@/server/db/repo/events";
import { listAllStations } from "@/server/db/repo/stations";
import { getOrganization } from "@/server/db/repo/core";
import { dayStartInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { PageHeader, StatCard } from "@/components/ui/layout";
import { MovementsBrowser } from "./movements-browser";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [stations, organization] = await Promise.all([
    listAllStations(user.organizationId),
    getOrganization(user.organizationId),
  ]);
  const organizationTimeZone = normalizeTimeZone(organization?.timezone);
  const from = dayStartInTimeZone(new Date(), -13, organizationTimeZone).toISOString();
  const to = new Date().toISOString();
  const [result, totals] = await Promise.all([
    listEvents({ orgId: user.organizationId, from, to, page: 1, pageSize: 50, stationIds: stationScopeForUser(user) }),
    movementTotals(user.organizationId, from, to, undefined, undefined, stationScopeForUser(user)),
  ]);
  const stationTimeZoneById = new Map(stations.map((station) => [station.id, normalizeTimeZone(station.timezone, organizationTimeZone)]));
  const rows = result.rows;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fuel movement ledger"
        description={`Every refill and tank outflow derived from consecutive probe readings. Timestamps are shown in each station's local time; all are stored in UTC. Organization default: ${organizationTimeZone}.`}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tank outflow (14 days)"
          value={Math.round(totals.consumption).toLocaleString()}
          unit="L"
          tone="info"
          hint="Fuel consumption / tank outflow - not the same as fuel sold until dispenser integration exists."
        />
        <StatCard
          label="Refills (14 days)"
          value={Math.round(totals.refills).toLocaleString()}
          unit="L"
          tone="ok"
          hint="Detected from sustained level increases."
        />
        <StatCard
          label="Suspected loss (14 days)"
          value={Math.round(totals.suspectedLoss).toLocaleString()}
          unit="L"
          tone={totals.suspectedLoss > 0 ? "warn" : "neutral"}
          hint="Possible anomaly flagged for investigation - never auto-classified as theft."
        />
        <StatCard
          label="Events recorded"
          value={rows.length}
          tone="neutral"
          hint="Most recent movements across all tanks."
        />
      </section>

      <MovementsBrowser
        initialRows={rows.map((event) => ({
          id: event.id,
          ts: event.ts,
          type: event.type,
          volume: Number(event.volume),
          levelBefore: Number(event.levelBefore),
          levelAfter: Number(event.levelAfter),
          confidence: event.confidence,
          status: event.status,
          reason: event.reason,
          tankId: event.tankId,
          stationId: event.stationId,
          deviceId: event.deviceId,
          timeZone: stationTimeZoneById.get(event.stationId) ?? organizationTimeZone,
        }))}
        from={from}
        to={to}
        organizationTimeZone={organizationTimeZone}
      />

      <p className="text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
        Need the underlying measurements? Every tank's raw readings are available on its{" "}
        <Link href="/tanks" className="text-[var(--brand-ink)] hover:underline">
          detail page
        </Link>
        .
      </p>
    </div>
  );
}
