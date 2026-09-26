"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";

interface RuleType {
  value: string;
  label: string;
  severity: string;
  condition: Record<string, unknown>;
}

export function RuleForm({
  ruleTypes,
  tanks,
  stations,
  fuelTypes,
}: {
  ruleTypes: RuleType[];
  tanks: { id: string; name: string }[];
  stations: { id: string; name: string }[];
  fuelTypes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: "",
    type: ruleTypes[0]?.value ?? "low_fuel",
    description: "",
    scope: "organization",
    tankId: "",
    stationId: "",
    fuelTypeId: "",
    severity: ruleTypes[0]?.severity ?? "warning",
    conditionValue: String(Object.values(ruleTypes[0]?.condition ?? { percent: 20 })[0] ?? ""),
    conditionKey: Object.keys(ruleTypes[0]?.condition ?? { percent: "" })[0] ?? "percent",
    cooldownMin: "30",
    isEnabled: true,
    channelInApp: true,
    channelEmail: false,
  });

  const selected = ruleTypes.find((type) => type.value === form.type) ?? ruleTypes[0];

  const set = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFieldErrors({});
  };

  const chooseType = (value: string) => {
    const type = ruleTypes.find((entry) => entry.value === value) ?? ruleTypes[0];
    const keys = Object.keys(type.condition);
    set({
      type: value,
      severity: type.severity,
      conditionKey: keys[0] ?? "percent",
      conditionValue: String(Object.values(type.condition)[0] ?? ""),
      name: form.name || `${type.label} alert`,
    });
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Give the rule a name.";
    if (form.scope === "tank" && !form.tankId) errors.tankId = "Select the tank this rule applies to.";
    if (form.scope === "station" && !form.stationId) errors.stationId = "Select the station this rule applies to.";
    const numeric = Number(form.conditionValue);
    if (!form.conditionValue || !Number.isFinite(numeric)) errors.conditionValue = "Enter a numeric threshold.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/alert-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          type: form.type,
          scope: form.scope,
          tankId: form.scope === "tank" ? form.tankId : null,
          stationId: form.scope === "station" ? form.stationId : null,
          fuelTypeId: form.fuelTypeId || null,
          severity: form.severity,
          condition: { [form.conditionKey]: Number(form.conditionValue) },
          channels: [form.channelInApp ? "in_app" : "", form.channelEmail ? "email" : ""].filter(Boolean),
          cooldownMin: Number(form.cooldownMin),
          isEnabled: form.isEnabled,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setError(payload?.error?.message ?? "Could not create the rule. Please try again.");
        return;
      }
      toast.success("Rule created", `${payload.data.name} is now watching for this condition.`);
      router.push("/alerts/rules");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error ? (
        <Notice tone="crit" title="Could not create the rule">
          {error}
        </Notice>
      ) : null}

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">What to watch</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Rule name" htmlFor="name" required error={fieldErrors.name} className="sm:col-span-2">
            <Input
              id="name"
              value={form.name}
              invalid={Boolean(fieldErrors.name)}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Diesel tanks below 20%"
              maxLength={120}
            />
          </Field>
          <Field label="Condition" htmlFor="type" required>
            <Select
              id="type"
              value={form.type}
              onChange={(event) => chooseType(event.target.value)}
              options={ruleTypes.map((type) => ({ value: type.value, label: type.label }))}
            />
          </Field>
          <Field label="Severity" htmlFor="severity" required>
            <Select
              id="severity"
              value={form.severity}
              onChange={(event) => set({ severity: event.target.value })}
              options={[
                { value: "critical", label: "Critical" },
                { value: "warning", label: "Warning" },
                { value: "info", label: "Info" },
              ]}
            />
          </Field>
          <Field
            label={`Threshold (${form.conditionKey})`}
            htmlFor="conditionValue"
            required
            error={fieldErrors.conditionValue}
            hint="The value that triggers the alert."
          >
            <Input
              id="conditionValue"
              value={form.conditionValue}
              invalid={Boolean(fieldErrors.conditionValue)}
              onChange={(event) => set({ conditionValue: event.target.value })}
              inputMode="decimal"
            />
          </Field>
          <Field
            label="Cooldown (minutes)"
            htmlFor="cooldownMin"
            hint="Minimum gap before the same alert can fire again."
          >
            <Input
              id="cooldownMin"
              value={form.cooldownMin}
              onChange={(event) => set({ cooldownMin: event.target.value })}
              inputMode="numeric"
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Where to watch</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Scope" htmlFor="scope" required>
            <Select
              id="scope"
              value={form.scope}
              onChange={(event) => set({ scope: event.target.value })}
              options={[
                { value: "organization", label: "Whole organization" },
                { value: "station", label: "A specific station" },
                { value: "tank", label: "A specific tank" },
                { value: "device", label: "A specific device" },
              ]}
            />
          </Field>
          {form.scope === "tank" ? (
            <Field label="Tank" htmlFor="tankId" required error={fieldErrors.tankId}>
              <Select
                id="tankId"
                value={form.tankId}
                onChange={(event) => set({ tankId: event.target.value })}
                options={tanks.map((tank) => ({ value: tank.id, label: tank.name }))}
                placeholder="Select a tank"
              />
            </Field>
          ) : null}
          {form.scope === "station" ? (
            <Field label="Station" htmlFor="stationId" required error={fieldErrors.stationId}>
              <Select
                id="stationId"
                value={form.stationId}
                onChange={(event) => set({ stationId: event.target.value })}
                options={stations.map((station) => ({ value: station.id, label: station.name }))}
                placeholder="Select a station"
              />
            </Field>
          ) : null}
          {form.scope !== "tank" ? (
            <Field label="Fuel type" htmlFor="fuelTypeId" hint="Optional. Narrow the rule to one fuel type.">
              <Select
                id="fuelTypeId"
                value={form.fuelTypeId}
                onChange={(event) => set({ fuelTypeId: event.target.value })}
                options={[{ value: "", label: "Any fuel type" }, ...fuelTypes.map((fuelType) => ({ value: fuelType.id, label: fuelType.name }))]}
              />
            </Field>
          ) : null}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Delivery</h2>
        <div className="mt-4 space-y-4">
          <Field label="Description" htmlFor="description" hint="Shown to operators when the alert fires.">
            <Textarea
              id="description"
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
              rows={2}
              placeholder="Fires when any diesel tank drops below 20% of usable capacity."
            />
          </Field>
          <Switch
            checked={form.channelInApp}
            onChange={(value) => set({ channelInApp: value })}
            label="In-app notification"
            description="Shows in the notification centre and on the dashboard."
          />
          <Switch
            checked={form.channelEmail}
            onChange={(value) => set({ channelEmail: value })}
            label="Email notification"
            description="Requires an SMTP transport to be configured in Settings → Notifications."
          />
          <Switch
            checked={form.isEnabled}
            onChange={(value) => set({ isEnabled: value })}
            label="Enable this rule immediately"
            description="You can disable a rule at any time without deleting it."
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          Create rule
        </Button>
      </div>
    </form>
  );
}
