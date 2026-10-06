"use client";

import { useState } from "react";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

export function SystemSettingsForm({
  initial,
}: {
  initial: {
    retentionDays: number;
    readingIntervalSec: number;
    offlineTimeoutMin: number;
    reconciliationVariancePct: number;
    simulatorEnabled: boolean;
    rateLimitMax: number;
  };
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          system: {
            readingIntervalSec: form.readingIntervalSec,
            offlineTimeoutMin: form.offlineTimeoutMin,
            reconciliationVariancePct: form.reconciliationVariancePct,
          },
        }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2400);
        toast.success("System settings saved", "Changes apply to the next evaluation cycle.");
      } else {
        setError(payload.error?.message ?? "Could not save the system settings.");
      }
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      {error ? <Notice tone="crit" title="Could not save">{error}</Notice> : null}

      <section className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Data & timing</h2>
            <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
              These controls are consumed by telemetry freshness, device-health monitoring, and reconciliation.
            </p>
          </div>
          {saved ? (
            <span className="badge badge-ok">
              <Check size={12} />
              Saved
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--ink-3)]">Retention policy</p>
            <p className="mt-1 text-[0.875rem] font-medium text-[var(--ink)]">Not active</p>
            <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">
              No readings are automatically deleted. The stored {form.retentionDays}-day legacy value is not applied; a
              retention policy requires separate approval.
            </p>
          </div>
          <Field
            label="Expected reading interval (seconds)"
            htmlFor="sys-interval"
            hint="Telemetry is shown as live for 1.5 times this interval, then delayed until the offline timeout."
          >
            <Input
              id="sys-interval"
              type="number"
              min={10}
              max={3600}
              value={form.readingIntervalSec}
              onChange={(event) => setForm({ ...form, readingIntervalSec: Number(event.target.value) })}
            />
          </Field>
          <Field
            label="Offline timeout (minutes)"
            htmlFor="sys-offline"
            hint="A device silent for this long is marked offline and its last valid reading is preserved."
          >
            <Input
              id="sys-offline"
              type="number"
              min={1}
              max={240}
              value={form.offlineTimeoutMin}
              onChange={(event) => setForm({ ...form, offlineTimeoutMin: Number(event.target.value) })}
            />
          </Field>
          <Field
            label="Reconciliation variance threshold (%)"
            htmlFor="sys-variance"
            hint="Variance beyond this raises a reconciliation alert - never an automatic theft claim."
          >
            <Input
              id="sys-variance"
              type="number"
              min={0.1}
              max={20}
              step={0.1}
              value={form.reconciliationVariancePct}
              onChange={(event) => setForm({ ...form, reconciliationVariancePct: Number(event.target.value) })}
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Runtime</h2>
        <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
          These values come from the deployment environment and are shown here for verification. They cannot be changed
          from the interface, because they affect every tenant on the instance.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Rate limit / window</dt>
            <dd className="text-num mt-1 text-[0.875rem] font-medium text-[var(--ink)]">{form.rateLimitMax}</dd>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Demo simulator</dt>
            <dd className="mt-1">
              <span className={`badge ${form.simulatorEnabled ? "badge-warn" : "badge-ok"}`}>
                {form.simulatorEnabled ? "on - synthetic traffic" : "off - live data only"}
              </span>
            </dd>
          </div>
        </dl>

        {form.simulatorEnabled ? (
          <div className="mt-4">
            <Notice tone="warn" title="Demo simulator is available">
              <span className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>
                  Synthetic readings are available only through an explicit local/demo simulator run; Vercel never starts a
                  background worker for them. Every screen that shows simulated data is labelled as such. Keep{" "}
                  <code className="rounded bg-[var(--surface-3)] px-1 py-0.5">DEMO_SIMULATOR=off</code> in production and
                  connect a real probe for live data.
                </span>
              </span>
            </Notice>
          </div>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy}>
          Save system settings
        </Button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(initial)}>
          Reset
        </button>
      </div>
    </form>
  );
}
