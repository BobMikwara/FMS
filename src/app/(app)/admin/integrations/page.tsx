import { redirect } from "next/navigation";
import { Plug, KeyRound, CheckCircle2, XCircle } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getOrganization, listIntegrations } from "@/server/db/repo/core";
import { PageHeader, Notice } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { formatDateTimeInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { IntegrationsBrowser } from "./integrations-browser";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [integrations, organization] = await Promise.all([
    listIntegrations(user.organizationId),
    getOrganization(user.organizationId),
  ]);
  const timeZone = normalizeTimeZone(organization?.timezone);

  const rows = integrations.map((integration) => ({
    id: integration.id,
    provider: integration.provider,
    name: integration.name,
    kind: integration.kind,
    status: integration.status,
    secretRef: integration.secretRef,
    lastSyncAt: integration.lastSyncAt,
    lastError: integration.lastError,
    isEnabled: integration.isEnabled,
  }));

  const connected = rows.filter((row) => row.status === "connected" && row.isEnabled).length;
  const hasSecret = rows.filter((row) => Boolean(row.secretRef)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="Configure probe integrations and inspect provider registrations. GPS position ingestion, alert delivery channels, and accounting synchronization are not enabled here."
        breadcrumbs={[{ label: "Administration" }, { label: "Integrations" }]}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Integrations</p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">{rows.length}</p>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">{connected} marked enabled by configuration</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Credentials stored</p>
          <p className="text-num mt-1.5 text-[1.5rem] font-semibold tracking-tight text-[var(--ink)]">
            {hasSecret}/{rows.length}
          </p>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">Referenced by secret key, never exposed</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Probe data path</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[0.875rem] font-medium text-[var(--ink)]">
            <KeyRound size={14} className="text-[var(--ink-3)]" />
            Normalized on ingest
          </p>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">Fuel-probe payload → validation → reading row</p>
        </div>
      </div>

      <Notice tone="info" title="Credentials live in environment variables">
        The secret values are never stored in the database or sent to the browser. This screen records which environment
        variable should hold each credential and whether a reference name is configured. The screen does not test vendor connectivity.
      </Notice>

      <IntegrationsBrowser initialRows={rows} canManage={hasPermission(user, "integrations.manage")} />

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">
          <Plug size={15} className="text-[var(--ink-3)]" />
          Ingest endpoint
        </h2>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          A fuel probe or gateway pushes tank readings to{" "}
          <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[0.75rem]">POST /api/webhooks/device/{"{provider}"}</code>{" "}
          with the organization ingest key. The provider adapter validates the payload, normalizes it into the common
          reading shape, and rejects impossible values (negative volume, level above capacity) before they reach the
          database. GPS provider keys are registration scaffolding and return 501 rather than passing through the tank-fuel engine.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="ok">
            <CheckCircle2 size={12} />
            Validation
          </Badge>
          <Badge tone="ok">
            <CheckCircle2 size={12} />
            Normalization
          </Badge>
          <Badge tone="warn">
            <XCircle size={12} />
            Vendor-specific code per provider
          </Badge>
        </div>
        <p className="mt-3 text-[0.75rem] text-[var(--ink-3)]">
          Example payload shape is shown when you open an integration: <code>{`{ stationId, tankId, deviceId, timestamp, fuelType, volumeLiters, levelPercent, temperature, waterLevel, signal }`}</code>
        </p>
      </section>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.875rem] font-medium text-[var(--ink)]">No integrations configured yet</p>
          <p className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Configure a supported fuel-probe integration to receive tank readings. GPS positions are not ingested in this build, and the local simulator runs only when explicitly enabled.
          </p>
        </div>
      ) : null}

      <p className="text-[0.75rem] text-[var(--ink-3)]">
        {rows.some((row) => row.lastSyncAt)
          ? `Most recent sync: ${formatDateTimeInTimeZone(
              rows
                .filter((row) => row.lastSyncAt)
                .sort((a, b) => (b.lastSyncAt ?? "").localeCompare(a.lastSyncAt ?? ""))[0].lastSyncAt!,
              timeZone,
            )} (${timeZone}). Timestamps are always shown so delayed or stale data is obvious.`
          : "No sync activity recorded yet."}
      </p>
    </div>
  );
}
