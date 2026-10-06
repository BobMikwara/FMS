import { redirect } from "next/navigation";
import { Activity, Database, Cpu, ShieldCheck, Server } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { getSettings } from "@/server/db/repo/core";
import { countReadings } from "@/server/db/repo/readings";
import { countDevices } from "@/server/db/repo/devices";
import { countTanks } from "@/server/db/repo/stations";
import { listAllStations } from "@/server/db/repo/stations";
import { resolveOperatorSettings } from "@/server/domain/system-config";
import { listAllVehicles } from "@/server/db/repo/devices";
import { PageHeader, Notice } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { SystemSettingsForm } from "./system-settings-form";

export const dynamic = "force-dynamic";

const ENV_KEYS = [
  { key: "DATABASE_URL", label: "Database", hint: "SQLite file path or PostgreSQL connection string" },
  { key: "AUTH_SECRET", label: "Auth secret", hint: "Signs session JWTs - must be long and random" },
  { key: "AUTH_URL", label: "Auth URL", hint: "Public origin used in password reset links" },
  { key: "DEMO_SIMULATOR", label: "Demo simulator", hint: "on permits explicit local/demo simulator runs" },
  { key: "RATE_LIMIT_MAX", label: "Rate limit", hint: "Requests per window per client" },
  { key: "SMTP_HOST", label: "SMTP host", hint: "Required before password reset emails can be sent" },
  { key: "CRON_SECRET", label: "Cron secret", hint: "Authorizes the Vercel maintenance sweep" },
];

export default async function SystemSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = (await getSettings(user.organizationId));
  const system = resolveOperatorSettings(settings);

  const org = user.organizationId;
  const stations = (await listAllStations(org)).length;
  const tanks = (await countTanks(org));
  const devices = (await countDevices(org));
  const vehicles = (await listAllVehicles(org)).length;
  const readings = (await countReadings(org));

  return (
    <div className="space-y-5">
      <PageHeader
        title="System"
        description="Platform behaviour, data retention and diagnostics. Everything on this screen is operator-level configuration."
        breadcrumbs={[{ label: "Settings" }, { label: "System" }]}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">
            <Server size={12} /> Stations
          </p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">{stations}</p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">
            <Database size={12} /> Tanks
          </p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">{tanks}</p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">
            <Cpu size={12} /> Devices
          </p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">{devices}</p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">
            <Activity size={12} /> Readings stored
          </p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">
            {readings.toLocaleString("en-US")}
          </p>
        </div>
      </div>

      <SystemSettingsForm
        initial={{
          retentionDays: system.retentionDays,
          readingIntervalSec: system.readingIntervalSec,
          offlineTimeoutMin: system.offlineTimeoutMin,
          reconciliationVariancePct: system.reconciliationVariancePct,
          simulatorEnabled: process.env.DEMO_SIMULATOR === "on",
          rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 240),
        }}
      />

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">
          <ShieldCheck size={15} className="text-[var(--ink-3)]" />
          Environment configuration
        </h2>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          These values are read from the deployment environment. They are never stored in the database or returned by the
          API, so this screen only reports whether each one is present.
        </p>
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {ENV_KEYS.map((entry) => {
            const present = Boolean(process.env[entry.key]);
            return (
              <li key={entry.key} className="flex flex-wrap items-center gap-3 py-2.5">
                <code className="min-w-0 flex-1 truncate text-[0.75rem] text-[var(--ink)]">{entry.key}</code>
                <span className="w-40 shrink-0 text-[0.75rem] text-[var(--ink-3)]">{entry.label}</span>
                <Badge tone={present ? "ok" : "warn"}>{present ? "configured" : "not set"}</Badge>
                <span className="w-full text-[0.6875rem] text-[var(--ink-3)] sm:w-64">{entry.hint}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
          Never commit real credentials. Copy <code>.env.example</code> to <code>.env</code> and fill in the values for
          your deployment; the platform fails loudly rather than silently falling back to a default secret.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Fleet</h2>
        <p className="mt-2 text-[0.8125rem] text-[var(--ink-2)]">
          {vehicles} vehicle{vehicles === 1 ? "" : "s"} in the fleet registry. Live GPS positions are not available until
          vehicle telemetry is stored; a vehicle's assigned home station is a static reference, not a tracker location.
        </p>
      </section>
    </div>
  );
}
