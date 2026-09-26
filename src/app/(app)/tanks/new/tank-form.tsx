"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

interface FuelTypeOption {
  id: string;
  name: string;
}

interface StationOption {
  id: string;
  name: string;
}

export function TankForm({ stations, fuelTypes }: { stations: StationOption[]; fuelTypes: FuelTypeOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "",
    code: "",
    stationId: stations[0]?.id ?? "",
    fuelTypeId: fuelTypes[0]?.id ?? "",
    capacity: "",
    tankType: "underground",
    manufacturer: "",
    installationDate: "",
    lowThresholdPct: "20",
    criticalThresholdPct: "10",
    overfillThresholdPct: "95",
    notes: "",
  });

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Enter a tank name.";
    if (!form.code.trim()) errors.code = "Enter a short tank code.";
    if (!form.stationId) errors.stationId = "Select a station.";
    if (!form.fuelTypeId) errors.fuelTypeId = "Select a fuel type.";
    const capacity = Number(form.capacity);
    if (!form.capacity || !Number.isFinite(capacity) || capacity <= 0) {
      errors.capacity = "Capacity must be a positive number of liters.";
    } else if (capacity > 5_000_000) {
      errors.capacity = "That capacity looks implausibly large. Please check the value.";
    }
    const low = Number(form.lowThresholdPct);
    const critical = Number(form.criticalThresholdPct);
    const overfill = Number(form.overfillThresholdPct);
    if (!Number.isFinite(low) || low < 1 || low > 100) errors.lowThresholdPct = "Use a percentage between 1 and 100.";
    if (!Number.isFinite(critical) || critical < 1 || critical > 100) {
      errors.criticalThresholdPct = "Use a percentage between 1 and 100.";
    } else if (Number.isFinite(low) && critical >= low) {
      errors.criticalThresholdPct = "The critical threshold must be below the low threshold.";
    }
    if (!Number.isFinite(overfill) || overfill < 50 || overfill > 100) {
      errors.overfillThresholdPct = "Use a percentage between 50 and 100.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/tanks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          stationId: form.stationId,
          fuelTypeId: form.fuelTypeId,
          capacity: Number(form.capacity),
          tankType: form.tankType,
          manufacturer: form.manufacturer.trim() || null,
          installationDate: form.installationDate || null,
          lowThresholdPct: Number(form.lowThresholdPct),
          criticalThresholdPct: Number(form.criticalThresholdPct),
          overfillThresholdPct: Number(form.overfillThresholdPct),
          notes: form.notes.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? "Could not create the tank. Please try again.");
        return;
      }
      toast.success("Tank created", `${payload.data.name} is ready to be assigned a device.`);
      router.push(`/tanks/${payload.data.id}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (stations.length === 0) {
    return (
      <div className="card p-8">
        <Notice tone="warn" title="Create a station first">
          A tank must belong to a station. Add a station, then come back to create tanks.
        </Notice>
        <div className="mt-4">
          <Button variant="primary" onClick={() => router.push("/stations/new")}>
            Add station
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <PageHeader
        title="Add tank"
        description="Tanks store the probe readings that drive every metric, alert and report in the platform."
        breadcrumbs={[{ label: "Tanks", href: "/tanks" }, { label: "Add tank" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" type="button" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Create tank
            </Button>
          </div>
        }
      />

      {error ? (
        <Notice tone="crit" title="Could not create the tank">
          {error}
        </Notice>
      ) : null}

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Tank details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Tank name" htmlFor="name" required error={fieldErrors.name}>
            <Input
              id="name"
              value={form.name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Diesel Tank A"
              maxLength={120}
            />
          </Field>
          <Field label="Tank code" htmlFor="code" required error={fieldErrors.code} hint="Short identifier shown in tables and exports.">
            <Input
              id="code"
              value={form.code}
              invalid={Boolean(fieldErrors.code)}
              onChange={(event) => set("code", event.target.value.toUpperCase())}
              placeholder="DA"
              maxLength={24}
            />
          </Field>
          <Field label="Station" htmlFor="stationId" required error={fieldErrors.stationId}>
            <Select
              id="stationId"
              value={form.stationId}
              onChange={(event) => set("stationId", event.target.value)}
              options={stations.map((station) => ({ value: station.id, label: station.name }))}
            />
          </Field>
          <Field label="Fuel type" htmlFor="fuelTypeId" required error={fieldErrors.fuelTypeId}>
            <Select
              id="fuelTypeId"
              value={form.fuelTypeId}
              onChange={(event) => set("fuelTypeId", event.target.value)}
              options={fuelTypes.map((fuelType) => ({ value: fuelType.id, label: fuelType.name }))}
            />
          </Field>
          <Field
            label="Usable capacity (L)"
            htmlFor="capacity"
            required
            error={fieldErrors.capacity}
            hint="The maximum volume the tank is rated to hold. Readings above this are rejected."
          >
            <Input
              id="capacity"
              value={form.capacity}
              invalid={Boolean(fieldErrors.capacity)}
              onChange={(event) => set("capacity", event.target.value)}
              placeholder="50000"
              inputMode="numeric"
            />
          </Field>
          <Field label="Tank type" htmlFor="tankType" required>
            <Select
              id="tankType"
              value={form.tankType}
              onChange={(event) => set("tankType", event.target.value)}
              options={[
                { value: "underground", label: "Underground" },
                { value: "above_ground", label: "Above ground" },
              ]}
            />
          </Field>
          <Field label="Manufacturer" htmlFor="manufacturer" hint="Optional.">
            <Input
              id="manufacturer"
              value={form.manufacturer}
              onChange={(event) => set("manufacturer", event.target.value)}
              placeholder="Tectonic"
              maxLength={80}
            />
          </Field>
          <Field label="Installation date" htmlFor="installationDate" hint="Optional.">
            <Input
              id="installationDate"
              type="date"
              value={form.installationDate}
              onChange={(event) => set("installationDate", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Alert thresholds</h2>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
          Thresholds are evaluated against measured volume divided by usable capacity. Full is 85–100%, normal is 30–84%,
          low is 15–29% and critical is below the value you set here.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Low threshold (%)" htmlFor="low" required error={fieldErrors.lowThresholdPct}>
            <Input
              id="low"
              value={form.lowThresholdPct}
              invalid={Boolean(fieldErrors.lowThresholdPct)}
              onChange={(event) => set("lowThresholdPct", event.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Critical threshold (%)" htmlFor="critical" required error={fieldErrors.criticalThresholdPct}>
            <Input
              id="critical"
              value={form.criticalThresholdPct}
              invalid={Boolean(fieldErrors.criticalThresholdPct)}
              onChange={(event) => set("criticalThresholdPct", event.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Overfill threshold (%)" htmlFor="overfill" required error={fieldErrors.overfillThresholdPct}>
            <Input
              id="overfill"
              value={form.overfillThresholdPct}
              invalid={Boolean(fieldErrors.overfillThresholdPct)}
              onChange={(event) => set("overfillThresholdPct", event.target.value)}
              inputMode="numeric"
            />
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
              placeholder="Calibration notes, maintenance history, access details…"
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          Create tank
        </Button>
      </div>
    </form>
  );
}
