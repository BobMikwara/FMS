"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice, PageHeader } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

interface Option {
  id: string;
  label: string;
}

export interface VehicleFormValues {
  id?: string;
  name: string;
  plateNumber: string;
  type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelTypeId: string | null;
  tankCapacity: number | null;
  stationId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  odometerKm: number | null;
  notes: string | null;
}

interface VehicleFormProps {
  stations: Option[];
  fuelTypes: Option[];
  /** Existing vehicle count, used only for the footer hint. */
  vehicleCount: number;
  /** When present the form edits this vehicle instead of creating a new one. */
  vehicle?: VehicleFormValues | null;
}

const VEHICLE_TYPES = [
  { value: "tanker", label: "Tanker" },
  { value: "bowser", label: "Bowser" },
  { value: "truck", label: "Truck" },
  { value: "van", label: "Van" },
];

export function VehicleForm({ stations, fuelTypes, vehicleCount, vehicle = null }: VehicleFormProps) {
  const router = useRouter();
  const editing = Boolean(vehicle);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: vehicle?.name ?? "",
    plateNumber: vehicle?.plateNumber ?? "",
    type: vehicle?.type ?? "tanker",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year != null ? String(vehicle.year) : "",
    fuelTypeId: vehicle?.fuelTypeId ?? fuelTypes[0]?.id ?? "",
    tankCapacity: vehicle?.tankCapacity != null ? String(vehicle.tankCapacity) : "",
    stationId: vehicle?.stationId ?? stations[0]?.id ?? "",
    driverName: vehicle?.driverName ?? "",
    driverPhone: vehicle?.driverPhone ?? "",
    odometerKm: vehicle?.odometerKm != null ? String(vehicle.odometerKm) : "",
    notes: vehicle?.notes ?? "",
  });

  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Enter a vehicle name.";
    if (!form.plateNumber.trim()) errors.plateNumber = "Enter the plate number.";
    const capacity = Number(form.tankCapacity);
    if (form.tankCapacity && (!Number.isFinite(capacity) || capacity <= 0)) {
      errors.tankCapacity = "Tank capacity must be greater than zero.";
    }
    const year = Number(form.year);
    if (form.year && (!Number.isInteger(year) || year < 1950 || year > 2100)) {
      errors.year = "Enter a year between 1950 and 2100.";
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
      const response = await fetch(editing ? `/api/vehicles/${vehicle!.id}` : "/api/vehicles", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          plateNumber: form.plateNumber.trim(),
          type: form.type,
          make: form.make.trim() || null,
          model: form.model.trim() || null,
          year: form.year ? Number(form.year) : null,
          fuelTypeId: form.fuelTypeId || null,
          tankCapacity: form.tankCapacity ? Number(form.tankCapacity) : null,
          stationId: form.stationId || null,
          driverName: form.driverName.trim() || null,
          driverPhone: form.driverPhone.trim() || null,
          odometerKm: form.odometerKm ? Number(form.odometerKm) : null,
          notes: form.notes.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? (editing ? "Could not save the vehicle." : "Could not add the vehicle. Please try again."));
        return;
      }
      toast.success(
        editing ? "Vehicle updated" : "Vehicle added",
        `${payload.data.name} (${payload.data.plateNumber}) ${editing ? "has been updated." : "is ready for dispatch."}`,
      );
      router.push("/vehicles");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <PageHeader
        title={editing ? "Edit vehicle" : "Add vehicle"}
        description="Vehicles move fuel between sites. Pair a GPS tracker to compare dispatched volumes against what was delivered."
        breadcrumbs={[
          { label: "Vehicles", href: "/vehicles" },
          { label: editing ? (vehicle?.name ?? "Edit vehicle") : "Add vehicle" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" type="button" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Add vehicle
            </Button>
          </div>
        }
      />

      {error ? (
        <Notice tone="crit" title={editing ? "Could not save the vehicle" : "Could not add the vehicle"}>
          {error}
        </Notice>
      ) : null}

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Vehicle details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Vehicle name" htmlFor="name" required error={fieldErrors.name}>
            <Input
              id="name"
              value={form.name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Bowser 04"
              maxLength={120}
            />
          </Field>
          <Field
            label="Plate number"
            htmlFor="plateNumber"
            required
            error={fieldErrors.plateNumber}
            hint="Must be unique within your organization."
          >
            <Input
              id="plateNumber"
              value={form.plateNumber}
              invalid={Boolean(fieldErrors.plateNumber)}
              onChange={(event) => set("plateNumber", event.target.value.toUpperCase())}
              placeholder="T412 ABC"
              maxLength={32}
            />
          </Field>
          <Field label="Vehicle type" htmlFor="type" required>
            <Select
              id="type"
              value={form.type}
              onChange={(event) => set("type", event.target.value)}
              options={VEHICLE_TYPES}
            />
          </Field>
          <Field label="Fuel carried" htmlFor="fuelTypeId" hint="Used to reconcile deliveries against tank contents.">
            <Select
              id="fuelTypeId"
              value={form.fuelTypeId}
              onChange={(event) => set("fuelTypeId", event.target.value)}
              options={fuelTypes.map((fuelType) => ({ value: fuelType.id, label: fuelType.label }))}
            />
          </Field>
          <Field label="Make" htmlFor="make" hint="Optional.">
            <Input id="make" value={form.make} onChange={(event) => set("make", event.target.value)} placeholder="Isuzu" maxLength={80} />
          </Field>
          <Field label="Model" htmlFor="model" hint="Optional.">
            <Input id="model" value={form.model} onChange={(event) => set("model", event.target.value)} placeholder="FVZ 34" maxLength={80} />
          </Field>
          <Field label="Year" htmlFor="year" error={fieldErrors.year} hint="Optional.">
            <Input
              id="year"
              value={form.year}
              invalid={Boolean(fieldErrors.year)}
              onChange={(event) => set("year", event.target.value)}
              inputMode="numeric"
              placeholder="2021"
              maxLength={4}
            />
          </Field>
          <Field
            label="Tank capacity (L)"
            htmlFor="tankCapacity"
            error={fieldErrors.tankCapacity}
            hint="Optional. Nominal compartment volume of the vehicle."
          >
            <Input
              id="tankCapacity"
              value={form.tankCapacity}
              invalid={Boolean(fieldErrors.tankCapacity)}
              onChange={(event) => set("tankCapacity", event.target.value)}
              inputMode="decimal"
              placeholder="32000"
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Home station and driver</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Home station" htmlFor="stationId" hint="Optional. Where the vehicle is normally based.">
            <Select
              id="stationId"
              value={form.stationId}
              onChange={(event) => set("stationId", event.target.value)}
              options={[{ value: "", label: "No station" }, ...stations.map((station) => ({ value: station.id, label: station.label }))]}
            />
          </Field>
          <Field label="Odometer (km)" htmlFor="odometerKm" hint="Optional. Updated automatically once a tracker is paired.">
            <Input
              id="odometerKm"
              value={form.odometerKm}
              onChange={(event) => set("odometerKm", event.target.value)}
              inputMode="decimal"
              placeholder="128000"
            />
          </Field>
          <Field label="Driver name" htmlFor="driverName" hint="Optional. Shown to on-call operators.">
            <Input
              id="driverName"
              value={form.driverName}
              onChange={(event) => set("driverName", event.target.value)}
              placeholder="Juma Mwakalinga"
              maxLength={120}
            />
          </Field>
          <Field label="Driver phone" htmlFor="driverPhone" hint="Optional.">
            <Input
              id="driverPhone"
              value={form.driverPhone}
              onChange={(event) => set("driverPhone", event.target.value)}
              placeholder="+255 754 000 000"
              maxLength={40}
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
              placeholder="Compartment 2 is reserved for diesel only…"
            />
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {editing ? "Save changes" : "Add vehicle"}
        </Button>
      </div>
      <p className="text-right text-[0.6875rem] text-[var(--ink-3)]">
        {vehicleCount > 0
          ? `${vehicleCount} vehicle${vehicleCount === 1 ? "" : "s"} registered in this organization.`
          : "This is the first vehicle in this organization."}
      </p>
    </form>
  );
}
