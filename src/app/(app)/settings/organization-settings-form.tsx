"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  currency: string;
  units: string;
  tempUnit: string;
  timezone: string;
  locale: string;
  plan: string;
  stationCount: number;
}

const CURRENCIES = [
  { value: "TZS", label: "TZS - Tanzanian shilling" },
  { value: "KES", label: "KES - Kenyan shilling" },
  { value: "UGX", label: "UGX - Ugandan shilling" },
  { value: "USD", label: "USD - US dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - Pound sterling" },
];

const VOLUME_UNITS = [
  { value: "liters", label: "Liters (L)" },
  { value: "gallons", label: "US gallons (gal)" },
];

const TEMP_UNITS = [
  { value: "celsius", label: "Celsius (°C)" },
  { value: "fahrenheit", label: "Fahrenheit (°F)" },
];

const LOCALES = [
  { value: "en", label: "English" },
  { value: "sw", label: "Kiswahili" },
];

const TIMEZONES = [
  { value: "Africa/Dar_es_Salaam", label: "East Africa Time (UTC+3)" },
  { value: "Africa/Nairobi", label: "Nairobi (UTC+3)" },
  { value: "Africa/Kampala", label: "Kampala (UTC+3)" },
  { value: "UTC", label: "UTC" },
];

export function OrganizationSettingsForm({ organization, canManage }: { organization: OrganizationSettings; canManage: boolean }) {
  const [form, setForm] = useState({
    name: organization.name,
    slug: organization.slug,
    currency: organization.currency,
    units: organization.units,
    tempUnit: organization.tempUnit,
    timezone: organization.timezone,
    locale: organization.locale,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const dirty =
    form.name !== organization.name ||
    form.slug !== organization.slug ||
    form.currency !== organization.currency ||
    form.units !== organization.units ||
    form.tempUnit !== organization.tempUnit ||
    form.timezone !== organization.timezone ||
    form.locale !== organization.locale;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (payload.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2400);
        toast.success("Settings saved", "The change has been written to the audit log.");
      } else {
        setError(payload.error?.message ?? "Could not save the settings.");
      }
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card max-w-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Organization</h2>
          <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
            {organization.stationCount} station{organization.stationCount === 1 ? "" : "s"} on the {organization.plan} plan.
          </p>
        </div>
        {saved ? (
          <span className="badge badge-ok">
            <Check size={12} />
            Saved
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4">
          <Notice tone="crit" title="Could not save">{error}</Notice>
        </div>
      ) : null}

      <fieldset disabled={!canManage} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Organization name" htmlFor="org-name" required>
          <Input
            id="org-name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Slug" htmlFor="org-slug" required hint="Used in URLs and API identifiers.">
          <Input
            id="org-slug"
            required
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
          />
        </Field>
        <Field label="Currency" htmlFor="org-currency" required hint="Used wherever a monetary value is shown.">
          <Select
            id="org-currency"
            value={form.currency}
            onChange={(event) => setForm({ ...form, currency: event.target.value })}
            options={CURRENCIES}
          />
        </Field>
        <Field label="Volume unit" htmlFor="org-units" required>
          <Select
            id="org-units"
            value={form.units}
            onChange={(event) => setForm({ ...form, units: event.target.value })}
            options={VOLUME_UNITS}
          />
        </Field>
        <Field label="Temperature unit" htmlFor="org-temp" required>
          <Select
            id="org-temp"
            value={form.tempUnit}
            onChange={(event) => setForm({ ...form, tempUnit: event.target.value })}
            options={TEMP_UNITS}
          />
        </Field>
        <Field label="Language" htmlFor="org-locale" required>
          <Select
            id="org-locale"
            value={form.locale}
            onChange={(event) => setForm({ ...form, locale: event.target.value })}
            options={LOCALES}
          />
        </Field>
        <Field label="Timezone" htmlFor="org-tz" required className="sm:col-span-2">
          <Select
            id="org-tz"
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            options={TIMEZONES}
          />
        </Field>
      </fieldset>

      {canManage ? (
        <div className="mt-5 flex items-center gap-3 border-t border-[var(--line)] pt-5">
        <Button type="submit" loading={busy} disabled={!dirty}>
          Save changes
        </Button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!dirty}
          onClick={() =>
            setForm({
              name: organization.name,
              slug: organization.slug,
              currency: organization.currency,
              units: organization.units,
              tempUnit: organization.tempUnit,
              timezone: organization.timezone,
              locale: organization.locale,
            })
          }
        >
          Reset
        </button>
        </div>
      ) : null}

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
        Readings are always stored in litres and Celsius at the point of capture; these settings control how values are
        displayed, so changing them never rewrites history.
      </p>
    </form>
  );
}
