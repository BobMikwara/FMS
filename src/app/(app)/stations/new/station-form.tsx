"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/layout";

export interface StationFormValues {
  id?: string;
  name: string;
  code: string;
  address: string;
  city: string;
  region: string;
  country: string;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  openingTime: string | null;
  closingTime: string | null;
  notes: string | null;
  currency?: string;
  volumeUnit?: string;
}

interface StationFormProps {
  defaultCurrency: string;
  defaultCountry: string;
  /** When present the form edits this station instead of creating a new one. */
  station?: StationFormValues | null;
}

const REGIONS = [
  "Arusha",
  "Dar es Salaam",
  "Dodoma",
  "Geita",
  "Iringa",
  "Kagera",
  "Katavi",
  "Kigoma",
  "Kilimanjaro",
  "Lindi",
  "Manyara",
  "Mara",
  "Mbeya",
  "Morogoro",
  "Mtwara",
  "Mwanza",
  "Njombe",
  "Pemba North",
  "Pemba South",
  "Pwani",
  "Rukwa",
  "Ruvuma",
  "Shinyanga",
  "Simiyu",
  "Singida",
  "Songwe",
  "Tabora",
  "Tanga",
  "Unguja North",
  "Unguja South",
  "Zanzibar Central",
  "Zanzibar North",
  "Zanzibar Urban",
];

export function StationForm({ defaultCurrency, defaultCountry, station = null }: StationFormProps) {
  const router = useRouter();
  const editing = Boolean(station);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: station?.name ?? "",
    code: station?.code ?? "",
    address: station?.address ?? "",
    city: station?.city ?? "",
    region: station?.region ?? "Dar es Salaam",
    country: station?.country ?? defaultCountry,
    phone: station?.phone ?? "",
    email: station?.email ?? "",
    latitude: station?.latitude != null ? String(station.latitude) : "",
    longitude: station?.longitude != null ? String(station.longitude) : "",
    openingTime: station?.openingTime ?? "06:00",
    closingTime: station?.closingTime ?? "22:00",
    notes: station?.notes ?? "",
    notifyOnAlerts: true,
  });

  const set = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Enter a station name.";
    if (!form.code.trim()) errors.code = "Enter a short station code.";
    else if (!/^[A-Za-z0-9-]{2,12}$/.test(form.code.trim())) errors.code = "Use 2–12 letters, numbers or hyphens.";
    if (!form.city.trim()) errors.city = "Enter the city or town.";
    if (!form.address.trim()) errors.address = "Enter the street address.";
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.latitude || !Number.isFinite(lat) || Math.abs(lat) > 90) errors.latitude = "Latitude must be between −90 and 90.";
    if (!form.longitude || !Number.isFinite(lng) || Math.abs(lng) > 180) errors.longitude = "Longitude must be between −180 and 180.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/stations/${station!.id}` : "/api/stations", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          address: form.address.trim(),
          city: form.city.trim(),
          region: form.region,
          country: form.country.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          openingTime: form.openingTime,
          closingTime: form.closingTime,
          notes: form.notes.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(
          payload?.error?.message ??
            (editing ? "Could not save the station. Please try again." : "Could not create the station. Please try again."),
        );
        return;
      }
      toast.success(
        editing ? "Station updated" : "Station created",
        editing ? `${payload.data.name} has been updated.` : `${payload.data.name} is ready for tanks and devices.`,
      );
      router.push(editing ? `/stations/${station!.id}` : `/stations/${payload.data.id}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <PageHeader
        title={editing ? "Edit station" : "Add station"}
        description="A station groups tanks, devices, vehicles and the people who operate them."
        breadcrumbs={[
          { label: "Stations", href: "/stations" },
          { label: editing ? (station?.name ?? "Edit station") : "Add station" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => router.back()} type="button">
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editing ? "Save changes" : "Create station"}
            </Button>
          </div>
        }
      />

      {error ? (
        <Notice tone="crit" title={editing ? "Could not save the station" : "Could not create the station"}>
          {error}
        </Notice>
      ) : null}

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Station details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Station name" htmlFor="name" required error={fieldErrors.name} className="sm:col-span-2">
            <Input
              id="name"
              value={form.name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(event) => set("name", event.target.value)}
              placeholder="PUMA Arusha — Main Branch"
              maxLength={120}
            />
          </Field>
          <Field label="Station code" htmlFor="code" required error={fieldErrors.code} hint="Short identifier used in reports and exports.">
            <Input
              id="code"
              value={form.code}
              invalid={Boolean(fieldErrors.code)}
              onChange={(event) => set("code", event.target.value.toUpperCase())}
              placeholder="ARN-01"
              maxLength={12}
            />
          </Field>
          <Field label="Region" htmlFor="region" required>
            <Select
              id="region"
              value={form.region}
              onChange={(event) => set("region", event.target.value)}
              options={REGIONS.map((region) => ({ value: region, label: region }))}
            />
          </Field>
          <Field label="Street address" htmlFor="address" required error={fieldErrors.address} className="sm:col-span-2">
            <Input
              id="address"
              value={form.address}
              invalid={Boolean(fieldErrors.address)}
              onChange={(event) => set("address", event.target.value)}
              placeholder="12 Njiro Road"
              maxLength={200}
            />
          </Field>
          <Field label="City / town" htmlFor="city" required error={fieldErrors.city}>
            <Input
              id="city"
              value={form.city}
              invalid={Boolean(fieldErrors.city)}
              onChange={(event) => set("city", event.target.value)}
              placeholder="Arusha"
              maxLength={80}
            />
          </Field>
          <Field label="Country" htmlFor="country" required>
            <Input id="country" value={form.country} onChange={(event) => set("country", event.target.value)} maxLength={80} />
          </Field>
          <Field label="Phone" htmlFor="phone" hint="Optional. Shown to on-call operators.">
            <Input id="phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} placeholder="+255 754 000 000" />
          </Field>
          <Field label="Contact email" htmlFor="email" hint="Optional.">
            <Input id="email" type="email" value={form.email} onChange={(event) => set("email", event.target.value)} placeholder="ops@example.com" />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Location</h2>
        <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
          Used by the network map and to order stations geographically. Values are decimal degrees.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" htmlFor="latitude" required error={fieldErrors.latitude} hint="Between −90 and 90.">
            <Input
              id="latitude"
              value={form.latitude}
              invalid={Boolean(fieldErrors.latitude)}
              onChange={(event) => set("latitude", event.target.value)}
              placeholder="-3.38690"
              inputMode="decimal"
            />
          </Field>
          <Field label="Longitude" htmlFor="longitude" required error={fieldErrors.longitude} hint="Between −180 and 180.">
            <Input
              id="longitude"
              value={form.longitude}
              invalid={Boolean(fieldErrors.longitude)}
              onChange={(event) => set("longitude", event.target.value)}
              placeholder="36.68300"
              inputMode="decimal"
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Operating hours</h2>
        <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
          Deliveries outside these hours are flagged for review instead of being treated as normal refills.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Opening time" htmlFor="openingTime" required>
            <Input id="openingTime" type="time" value={form.openingTime} onChange={(event) => set("openingTime", event.target.value)} />
          </Field>
          <Field label="Closing time" htmlFor="closingTime" required>
            <Input id="closingTime" type="time" value={form.closingTime} onChange={(event) => set("closingTime", event.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Notes</h2>
        <div className="mt-4">
          <Field label="Internal notes" htmlFor="notes" hint="Optional. Only visible to your organization.">
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
              placeholder="Access instructions, gate codes, site manager contact…"
            />
          </Field>
        </div>
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <Switch
            checked={form.notifyOnAlerts}
            onChange={(value) => set("notifyOnAlerts", value)}
            label="Notify operators about alerts at this station"
            description="Sends in-app notifications to everyone with alert access when a threshold is crossed."
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {editing ? "Save changes" : "Create station"}
        </Button>
      </div>
      <p className="text-right text-[0.6875rem] text-[var(--ink-3)]">All monetary values use {defaultCurrency}.</p>
    </form>
  );
}
