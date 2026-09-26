"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/layout";
import { EmptyState, useToast } from "@/components/ui/feedback";

export interface ProviderOption {
  key: string;
  name: string;
  kind: "fuel_probe" | "gps";
  authMethod: "hmac" | "api_key" | "basic";
  description: string;
  supports: {
    fuelVolume: boolean;
    fuelHeight: boolean;
    temperature: boolean;
    waterLevel: boolean;
    signal: boolean;
    battery: boolean;
  };
}

export interface DeviceFormOption {
  id: string;
  label: string;
}

interface DeviceFormProps {
  providers: ProviderOption[];
  stations: DeviceFormOption[];
  /** Tanks that do not already have a fuel probe attached. */
  tanks: { id: string; label: string; stationId: string | null }[];
  vehicles: DeviceFormOption[];
  defaultStationId: string | null;
}

const AUTH_HINT: Record<ProviderOption["authMethod"], string> = {
  hmac: "This provider signs each webhook with HMAC-SHA256 over the raw body using the shared secret configured on the integration.",
  api_key: "This provider authenticates with a static API key sent in a request header.",
  basic: "This provider authenticates with HTTP basic auth using the configured credentials.",
};

export function DeviceForm({ providers, stations, tanks, vehicles, defaultStationId }: DeviceFormProps) {
  const router = useRouter();
  const toast = useToast();
  const probeProviders = useMemo(() => providers.filter((provider) => provider.kind === "fuel_probe"), [providers]);
  const gpsProviders = useMemo(() => providers.filter((provider) => provider.kind === "gps"), [providers]);

  const [type, setType] = useState<"fuel_probe" | "gps_tracker">("fuel_probe");
  const [form, setForm] = useState({
    serialNumber: "",
    label: "",
    provider: probeProviders[0]?.key ?? "tectonic",
    model: "",
    firmware: "",
    stationId: defaultStationId ?? "",
    tankId: "",
    vehicleId: "",
    notes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const activeProviders = type === "fuel_probe" ? probeProviders : gpsProviders;
  const activeProvider = activeProviders.find((provider) => provider.key === form.provider) ?? activeProviders[0] ?? null;
  const availableTanks = tanks.filter((tank) => !form.stationId || tank.stationId === form.stationId);

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const switchType = (next: "fuel_probe" | "gps_tracker") => {
    setType(next);
    const nextProviders = next === "fuel_probe" ? probeProviders : gpsProviders;
    setForm((current) => ({
      ...current,
      provider: nextProviders[0]?.key ?? current.provider,
      tankId: next === "fuel_probe" ? current.tankId : "",
      vehicleId: next === "gps_tracker" ? current.vehicleId : "",
    }));
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.serialNumber.trim()) errors.serialNumber = "Enter the serial number printed on the device.";
    else if (form.serialNumber.trim().length < 3) errors.serialNumber = "Serial numbers are at least 3 characters.";
    if (!activeProvider) errors.provider = "Choose the provider this device reports through.";
    if (type === "fuel_probe" && !form.tankId) errors.tankId = "Select the tank this probe measures.";
    if (type === "gps_tracker" && !form.vehicleId) errors.vehicleId = "Select the vehicle this tracker is fitted to.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          serialNumber: form.serialNumber.trim(),
          label: form.label.trim() || null,
          provider: form.provider,
          model: form.model.trim() || null,
          firmware: form.firmware.trim() || null,
          stationId: form.stationId || null,
          tankId: type === "fuel_probe" ? form.tankId : null,
          vehicleId: type === "gps_tracker" ? form.vehicleId : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? "Could not register the device. Please try again.");
        return;
      }
      setApiKey(payload.data.apiKey as string);
      toast.success("Device registered", `${payload.data.serialNumber} is ready to receive readings.`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const copyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      toast.success("API key copied", "Store it in the probe configuration now — it is not shown again.");
    } catch {
      toast.warn("Could not copy", "Select the key manually and copy it.");
    }
  };

  if (apiKey) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Device registered"
          description="Install this key on the probe so it can authenticate with the ingest endpoint."
          breadcrumbs={[{ label: "Devices", href: "/devices" }, { label: "Register device" }]}
        />
        <section className="card p-5">
          <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Ingest API key</h2>
          <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
            This is the only time the raw key is shown. Only its SHA-256 hash is stored, so it cannot be recovered
            afterwards — rotate it from the device list if it is lost.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-[16rem] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[0.75rem] text-[var(--ink)] break-all">
              {apiKey}
            </code>
            <Button variant="secondary" onClick={copyKey} type="button">
              Copy key
            </Button>
          </div>
          <div className="mt-5 border-t border-[var(--line)] pt-4">
            <h3 className="text-[0.75rem] font-semibold text-[var(--ink)]">Endpoint</h3>
            <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[0.6875rem] leading-relaxed text-[var(--ink-2)]">
{`POST /api/webhooks/device/${form.provider}
x-api-key: ${apiKey}
content-type: application/json`}
            </pre>
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => router.push("/devices")}>
            Back to devices
          </Button>
          <Button variant="primary" type="button" onClick={() => router.push(`/devices?search=${encodeURIComponent(form.serialNumber.trim())}`)}>
            View this device
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <PageHeader
        title="Register device"
        description="Fuel probes report tank volume; GPS trackers report position, speed and ignition for a vehicle."
        breadcrumbs={[{ label: "Devices", href: "/devices" }, { label: "Register device" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" type="button" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Register device
            </Button>
          </div>
        }
      />

      {error ? (
        <Notice tone="crit" title="Could not register the device">
          {error}
        </Notice>
      ) : null}

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Device type</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([
            {
              value: "fuel_probe" as const,
              title: "Fuel probe",
              body: "Measures volume, temperature and water level in an underground tank.",
            },
            {
              value: "gps_tracker" as const,
              title: "GPS tracker",
              body: "Reports location, speed, ignition and odometer for a vehicle.",
            },
          ]).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={type === option.value}
              onClick={() => switchType(option.value)}
              className={`rounded-[var(--radius)] border p-4 text-left transition-colors ${
                type === option.value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]"
              }`}
            >
              <span className="block text-[0.8125rem] font-semibold text-[var(--ink)]">{option.title}</span>
              <span className="mt-1 block text-[0.75rem] text-[var(--ink-3)]">{option.body}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Hardware</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Serial number"
            htmlFor="serialNumber"
            required
            error={fieldErrors.serialNumber}
            hint="Printed on the device casing. Used to match incoming payloads."
          >
            <Input
              id="serialNumber"
              value={form.serialNumber}
              invalid={Boolean(fieldErrors.serialNumber)}
              onChange={(event) => set("serialNumber", event.target.value.toUpperCase())}
              placeholder="PROBE-101204"
              maxLength={64}
            />
          </Field>
          <Field label="Label" htmlFor="label" hint="Optional friendly name for operators.">
            <Input
              id="label"
              value={form.label}
              onChange={(event) => set("label", event.target.value)}
              placeholder="Arusha Tank A probe"
              maxLength={120}
            />
          </Field>
          <Field
            label="Provider"
            htmlFor="provider"
            required
            error={fieldErrors.provider}
            hint={activeProvider ? AUTH_HINT[activeProvider.authMethod] : undefined}
          >
            <Select
              id="provider"
              value={form.provider}
              onChange={(event) => set("provider", event.target.value)}
              options={activeProviders.map((provider) => ({ value: provider.key, label: provider.name }))}
            />
          </Field>
          <Field label="Model" htmlFor="model" hint="Optional.">
            <Input
              id="model"
              value={form.model}
              onChange={(event) => set("model", event.target.value)}
              placeholder="Maglink LX-4"
              maxLength={80}
            />
          </Field>
          <Field label="Firmware" htmlFor="firmware" hint="Optional. Useful when diagnosing ingest problems.">
            <Input
              id="firmware"
              value={form.firmware}
              onChange={(event) => set("firmware", event.target.value)}
              placeholder="2.4.1"
              maxLength={40}
            />
          </Field>
          <Field label="Station" htmlFor="stationId" hint="Optional. Filters the list of tanks or vehicles.">
            <Select
              id="stationId"
              value={form.stationId}
              onChange={(event) => {
                set("stationId", event.target.value);
                setForm((current) => ({ ...current, tankId: "" }));
              }}
              options={[{ value: "", label: "No station" }, ...stations.map((station) => ({ value: station.id, label: station.label }))]}
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">
          {type === "fuel_probe" ? "Tank assignment" : "Vehicle assignment"}
        </h2>
        <div className="mt-4">
          {type === "fuel_probe" ? (
            availableTanks.length === 0 ? (
              <EmptyState
                title="No tanks available"
                description={
                  form.stationId
                    ? "Every tank at this station already has a probe. Choose another station or add a tank first."
                    : "Add a tank before registering a fuel probe — a probe has to measure something."
                }
                action={
                  <Button variant="secondary" type="button" onClick={() => router.push("/tanks/new")}>
                    + Add tank
                  </Button>
                }
              />
            ) : (
              <Field
                label="Tank"
                htmlFor="tankId"
                required
                error={fieldErrors.tankId}
                hint="Only tanks without an existing probe are listed."
              >
                <Select
                  id="tankId"
                  value={form.tankId}
                  onChange={(event) => set("tankId", event.target.value)}
                  options={[
                    { value: "", label: "Select a tank" },
                    ...availableTanks.map((tank) => ({ value: tank.id, label: tank.label })),
                  ]}
                />
              </Field>
            )
          ) : vehicles.length === 0 ? (
            <EmptyState
              title="No vehicles available"
              description="Add a vehicle before registering a GPS tracker."
              action={
                <Button variant="secondary" type="button" onClick={() => router.push("/vehicles/new")}>
                  + Add vehicle
                </Button>
              }
            />
          ) : (
            <Field label="Vehicle" htmlFor="vehicleId" required error={fieldErrors.vehicleId}>
              <Select
                id="vehicleId"
                value={form.vehicleId}
                onChange={(event) => set("vehicleId", event.target.value)}
                options={[
                  { value: "", label: "Select a vehicle" },
                  ...vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.label })),
                ]}
              />
            </Field>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">What this provider sends</h2>
        {activeProvider ? (
          <div className="mt-3">
            <p className="text-[0.8125rem] text-[var(--ink-2)]">{activeProvider.description}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {Object.entries({
                "Fuel volume": activeProvider.supports.fuelVolume,
                "Fuel height": activeProvider.supports.fuelHeight,
                Temperature: activeProvider.supports.temperature,
                "Water level": activeProvider.supports.waterLevel,
                Signal: activeProvider.supports.signal,
                Battery: activeProvider.supports.battery,
              }).map(([label, supported]) => (
                <li
                  key={label}
                  className={`rounded-full border px-2.5 py-1 text-[0.6875rem] ${
                    supported
                      ? "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok-ink)]"
                      : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-3)] line-through"
                  }`}
                >
                  {label}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.75rem] text-[var(--ink-3)]">
              Anything marked out is reported as “Not available” rather than estimated.
            </p>
          </div>
        ) : null}
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Notes</h2>
        <div className="mt-4">
          <Field label="Installation notes" htmlFor="notes" hint="Optional. Only visible to your organization.">
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
              placeholder="Probe mounted on the manway, 1.2 m drop tube…"
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          Register device
        </Button>
      </div>
    </form>
  );
}
