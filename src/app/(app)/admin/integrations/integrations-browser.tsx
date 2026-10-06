"use client";

import { useState } from "react";
import { Check, CheckCircle2, Clock, Copy, KeyRound, Plug, XCircle } from "lucide-react";
import { Badge, useToast } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlay";
import { timeAgo } from "@/lib/utils";

interface IntegrationRow {
  id: string;
  provider: string;
  name: string;
  kind: string;
  status: string;
  secretRef: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  isEnabled: boolean;
}

const KIND_LABELS: Record<string, string> = {
  probe: "Fuel probe",
  telematics: "GPS / telematics",
  notification: "Notifications",
  accounting: "Accounting",
  other: "Other",
};

const STATUS_META: Record<
  string,
  { tone: "ok" | "warn" | "crit" | "neutral"; label: string; icon: typeof CheckCircle2 }
> = {
  connected: { tone: "ok", label: "Enabled", icon: CheckCircle2 },
  pending: { tone: "warn", label: "Needs credentials", icon: Clock },
  disconnected: { tone: "neutral", label: "Disconnected", icon: XCircle },
  error: { tone: "crit", label: "Error", icon: XCircle },
};

const GPS_PROVIDER_KEYS = new Set(["queclink", "teltonika"]);

function gpsIngestUnavailable(integration: Pick<IntegrationRow, "provider" | "kind">): boolean {
  return integration.kind === "telematics" || GPS_PROVIDER_KEYS.has(integration.provider);
}

const EXAMPLE_PAYLOADS: Record<string, string> = {
  tectonic: JSON.stringify(
    {
      deviceSerial: "PROBE-100407",
      timestamp: "2026-09-25T15:42:21.000Z",
      volumeLiters: 38420,
      levelMm: 1108,
      levelPercent: 76.8,
      temperatureC: 28.4,
      waterLevelMm: 0,
      signal: -67,
    },
    null,
    2,
  ),
  veeder_root: JSON.stringify(
    {
      tank_id: "TNK-ARN01-DA",
      product_code: "DIESEL",
      observed_at: "2026-09-25T15:42:21.000Z",
      volume: 38420,
      ullage_pct: 23.2,
      tc_volume: 38250,
      temperature: 28.4,
      water: 0,
    },
    null,
    2,
  ),
  queclink: JSON.stringify(
    {
      imei: "863234021456789",
      timestamp: "2026-09-25T15:42:21.000Z",
      latitude: -6.7924,
      longitude: 39.2083,
      speed_kph: 42,
      ignition: true,
      odometer_km: 128433,
      fuel_level_pct: 68.4,
    },
    null,
    2,
  ),
  teltonika: JSON.stringify(
    {
      imei: "350742801234567",
      timestamp: "2026-09-25T15:42:21.000Z",
      lat: -6.7924,
      lng: 39.2083,
      speed: 42,
      ignition: true,
      odometer: 128433000,
      battery_voltage: 13.8,
    },
    null,
    2,
  ),
};

export function IntegrationsBrowser({ initialRows, canManage }: { initialRows: IntegrationRow[]; canManage: boolean }) {
  const [rows, setRows] = useState<IntegrationRow[]>(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntegrationRow | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const setStatus = async (integration: IntegrationRow, status: string) => {
    setBusyId(integration.id);
    try {
      const response = await fetch(`/api/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, isEnabled: status === "connected" }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setRows((current) =>
          current.map((row) => (row.id === integration.id ? { ...row, status, isEnabled: status === "connected" } : row)),
        );
        toast.success(
          status === "connected" ? "Integration enabled" : status === "disabled" ? "Integration disabled" : "Integration updated",
          integration.name,
        );
      } else {
        toast.error(payload.error?.message ?? "Could not update the integration.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const copyEndpoint = async (provider: string) => {
    const url = `${origin}/api/webhooks/device/${provider}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success("Endpoint copied", url);
    } catch {
      toast.info("Copy this endpoint manually", url);
    }
  };

  const example = detail ? EXAMPLE_PAYLOADS[detail.provider] : undefined;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.875rem] font-medium text-[var(--ink)]">No integrations yet</p>
          <p className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            Configure a supported fuel-probe integration to receive tank readings. GPS positions are not ingested in this build, and the local simulator runs only when explicitly enabled.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((integration) => {
            const gpsUnavailable = gpsIngestUnavailable(integration);
            const meta = gpsUnavailable
              ? { tone: "neutral" as const, label: "GPS ingest unavailable", icon: XCircle }
              : STATUS_META[integration.status] ?? STATUS_META.disconnected;
            const Icon = meta.icon;
            const live = !gpsUnavailable && integration.status === "connected" && integration.isEnabled;
            return (
              <li key={integration.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-2)]">
                      <Plug size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-[0.875rem] font-semibold text-[var(--ink)]">{integration.name}</h3>
                        <Badge tone={meta.tone}>
                          <Icon size={12} />
                          {meta.label}
                        </Badge>
                        <Badge tone="neutral">{KIND_LABELS[integration.kind] ?? integration.kind}</Badge>
                      </div>
                      <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
                        provider <code className="text-[0.6875rem]">{integration.provider}</code> ·{" "}
                        {integration.lastSyncAt ? `last sync ${timeAgo(integration.lastSyncAt)}` : "never synced"}
                        {integration.secretRef ? " · credential configured" : " · no credential"}
                      </p>
                      {integration.lastError ? (
                        <p className="mt-1.5 max-w-xl text-[0.75rem] leading-relaxed text-[var(--crit-ink)]">
                          Last error: {integration.lastError}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {gpsUnavailable ? (
                      <span className="badge badge-neutral">Position endpoint unavailable</span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => copyEndpoint(integration.provider)}>
                        Copy endpoint
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDetail(integration)}>
                      Details
                    </Button>
                    {canManage && !gpsUnavailable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busyId === integration.id}
                        onClick={() => setStatus(integration, live ? "disconnected" : "connected")}
                      >
                        {live ? "Disable" : "Enable"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ""}
        description="Configuration details and reference payload. GPS providers are not enabled for telemetry ingestion."
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Status</dt>
                <dd className="mt-1 text-[0.875rem] font-medium capitalize text-[var(--ink)]">{detail.status}</dd>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Kind</dt>
                <dd className="mt-1 text-[0.875rem] font-medium text-[var(--ink)]">{KIND_LABELS[detail.kind] ?? detail.kind}</dd>
              </div>
            </dl>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-[var(--ink)]">
                <KeyRound size={14} className="text-[var(--ink-3)]" />
                Credential reference
              </p>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                {detail.secretRef ? (
                  <>
                    The secret is read from the environment variable{" "}
                    <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[0.75rem]">{detail.secretRef}</code> on
                    the server. It is never stored in the database and never sent to the browser.
                  </>
                ) : (
                  <>
                    No credential is stored yet. Add{" "}
                    <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-[0.75rem]">
                      {`${detail.provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`}
                    </code>{" "}
                    to your deployment environment, then record its name as the credential reference for this integration.
                  </>
                )}
              </p>
            </div>

            {gpsIngestUnavailable(detail) ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <p className="text-[0.8125rem] font-medium text-[var(--ink)]">GPS ingestion is unavailable</p>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
                  This provider is a registry scaffold. No position endpoint is available; GPS webhook requests return 501
                  and are not written to the fuel-reading path.
                </p>
              </div>
            ) : (
              <div>
                <p className="text-[0.8125rem] font-medium text-[var(--ink)]">Fuel-probe ingest endpoint</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 text-[0.75rem] text-[var(--ink-2)]">
                    {`${origin}/api/webhooks/device/${detail.provider}`}
                  </code>
                  <Button size="sm" variant="secondary" onClick={() => copyEndpoint(detail.provider)}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="mt-2 text-[0.75rem] text-[var(--ink-3)]">
                  Send the device API key in the <code>x-device-key</code> header. Requests without a valid key are rejected.
                </p>
              </div>
            )}

            {example ? (
              <div>
                <p className="text-[0.8125rem] font-medium text-[var(--ink)]">
                  {gpsIngestUnavailable(detail) ? "Reference payload only (not ingested)" : "Example fuel-probe payload"}
                </p>
                <pre className="mt-2 max-h-52 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[0.6875rem] leading-relaxed text-[var(--ink-2)]">
                  {example}
                </pre>
                <p className="mt-2 text-[0.75rem] text-[var(--ink-3)]">
                  {gpsIngestUnavailable(detail)
                    ? "GPS position, speed, ignition, and odometer fields are not mapped or stored by this build."
                    : "The fuel-probe adapter validates and normalizes readings before they are stored."}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

    </div>
  );
}
