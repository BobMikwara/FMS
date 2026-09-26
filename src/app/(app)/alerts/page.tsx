import { getCurrentUser } from "@/server/auth/session";
import { listAlerts } from "@/server/db/repo/alerts";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { PageHeader, StatCard } from "@/components/ui/layout";
import { AlertsBrowser } from "./alerts-browser";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { rows } = listAlerts({ orgId: user.organizationId, pageSize: 50 });
  const stations = listAllStations(user.organizationId);
  const tanks = listAllTanks(user.organizationId);
  const stationName = new Map(stations.map((station) => [station.id, station.name]));
  const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));

  const enriched = rows.map((alert) => ({
    ...alert,
    stationName: stationName.get(alert.stationId) ?? null,
    tankName: alert.tankId ? (tankName.get(alert.tankId) ?? null) : null,
  }));

  const active = enriched.filter((alert) => alert.status === "active");
  const acknowledged = enriched.filter((alert) => alert.status === "acknowledged");
  const resolved = enriched.filter((alert) => alert.status === "resolved");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alert centre"
        description="Alerts move through Active → Acknowledged → Resolved. Acknowledge to take ownership, then resolve with a note so the next operator understands what happened."
        actions={
          <a href="/alerts/rules" className="btn btn-secondary btn-sm">
            Alert rules
          </a>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active alerts"
          value={active.length}
          tone={active.length > 0 ? "crit" : "ok"}
          hint={`${active.filter((alert) => alert.severity === "critical").length} critical severity`}
        />
        <StatCard
          label="Acknowledged"
          value={acknowledged.length}
          tone={acknowledged.length > 0 ? "warn" : "ok"}
          hint="Being worked on by someone on your team."
        />
        <StatCard label="Resolved" value={resolved.length} tone="ok" hint="Closed with a resolution note." />
        <StatCard
          label="Total on record"
          value={enriched.length}
          tone="neutral"
          hint="Every alert ever raised for this organization."
        />
      </section>

      <AlertsBrowser
        initialRows={enriched}
        stations={stations.map((station) => ({ id: station.id, name: station.name }))}
      />

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">How alerts are raised</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Reading arrives",
              body: "A probe pushes a reading through the device integration layer. It is validated against the tank before anything else happens.",
            },
            {
              step: "2",
              title: "Movement is classified",
              body: "The engine compares the reading with the previous one to decide whether it was a refill, outflow or an anomaly.",
            },
            {
              step: "3",
              title: "Rules are evaluated",
              body: "Your configured rules decide whether the change warrants an alert. Anomalies are flagged, never auto-classified as theft.",
            },
          ].map((item) => (
            <li key={item.step} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5">
              <span className="text-num flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[0.6875rem] font-semibold text-[var(--brand)]">
                {item.step}
              </span>
              <p className="mt-2.5 text-[0.8125rem] font-semibold text-[var(--ink)]">{item.title}</p>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
