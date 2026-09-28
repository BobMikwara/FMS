import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { listEvents, movementTotals } from "@/server/db/repo/events";
import { isoDaysAgo } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/ui/layout";
import { MovementsBrowser } from "./movements-browser";

export const dynamic = "force-dynamic";

export default async function MovementsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const from = isoDaysAgo(14);
  const to = new Date().toISOString();
  const { rows } = (await listEvents({ orgId: user.organizationId, from, to, page: 1, pageSize: 50 }));
  const totals = (await movementTotals(user.organizationId, from, to));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fuel movement ledger"
        description="Every refill and tank outflow derived from consecutive probe readings. Raw readings are stored separately from these derived events, so the audit trail stays intact."
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
        }))}
        from={from}
        to={to}
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
