"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/form";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

const CHANNELS = [
  { value: "in_app", label: "In-app", description: "Notification centre and dashboard" },
  { value: "email", label: "Email", description: "Sent to the recipient list below" },
  { value: "sms", label: "SMS", description: "Text message - reserved for critical alerts" },
  { value: "push", label: "Push", description: "Browser push when installed as a PWA" },
];

export function NotificationSettingsForm({
  initial,
  users,
}: {
  initial: {
    channelsEnabled: string[];
    criticalChannels: string[];
    dailyDigest: boolean;
    weeklyDigest: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    recipients: string[];
  };
  users: { id: string; name: string; email: string; roleName: string }[];
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const toggle = (key: "channelsEnabled" | "criticalChannels", value: string) => {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((entry) => entry !== value) : [...current[key], value],
    }));
  };

  const toggleRecipient = (email: string) => {
    setForm((current) => ({
      ...current,
      recipients: current.recipients.includes(email)
        ? current.recipients.filter((entry) => entry !== email)
        : [...current.recipients, email],
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notifications: form }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2400);
        toast.success("Notification settings saved", "Changes apply to the next alert.");
      } else {
        setError(payload.error?.message ?? "Could not save the notification settings.");
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
            <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Channels</h2>
            <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
              Choose where ordinary alerts are delivered, and where critical ones are delivered.
            </p>
          </div>
          {saved ? (
            <span className="badge badge-ok">
              <Check size={12} />
              Saved
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
            <p className="text-[0.75rem] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Standard alerts</p>
            <div className="mt-2.5 space-y-2">
              {CHANNELS.map((channel) => (
                <label key={channel.value} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-[var(--line-strong)]"
                    checked={form.channelsEnabled.includes(channel.value)}
                    onChange={() => toggle("channelsEnabled", channel.value)}
                  />
                  <span>
                    <span className="block text-[0.8125rem] font-medium text-[var(--ink)]">{channel.label}</span>
                    <span className="block text-[0.6875rem] text-[var(--ink-3)]">{channel.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
            <p className="text-[0.75rem] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Critical alerts</p>
            <div className="mt-2.5 space-y-2">
              {CHANNELS.map((channel) => (
                <label key={channel.value} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-[var(--line-strong)]"
                    checked={form.criticalChannels.includes(channel.value)}
                    onChange={() => toggle("criticalChannels", channel.value)}
                  />
                  <span>
                    <span className="block text-[0.8125rem] font-medium text-[var(--ink)]">{channel.label}</span>
                    <span className="block text-[0.6875rem] text-[var(--ink-3)]">{channel.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Quiet hours</h2>
        <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
          Critical alerts ignore quiet hours. Everything else is held until the window ends.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="From" htmlFor="quiet-start">
            <Input
              id="quiet-start"
              type="time"
              value={form.quietHoursStart}
              onChange={(event) => setForm({ ...form, quietHoursStart: event.target.value })}
            />
          </Field>
          <Field label="To" htmlFor="quiet-end">
            <Input
              id="quiet-end"
              type="time"
              value={form.quietHoursEnd}
              onChange={(event) => setForm({ ...form, quietHoursEnd: event.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Digests</h2>
        <div className="mt-4 space-y-4">
          <Switch
            checked={form.dailyDigest}
            onChange={(value) => setForm({ ...form, dailyDigest: value })}
            label="Daily digest"
            description="One summary every morning covering the previous day's consumption, refills and unresolved alerts."
          />
          <Switch
            checked={form.weeklyDigest}
            onChange={(value) => setForm({ ...form, weeklyDigest: value })}
            label="Weekly digest"
            description="One summary every Monday covering the previous week."
          />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Recipients</h2>
        <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">
          {form.recipients.length} of {users.length} people in this organization receive notifications.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {users.map((person) => {
            const checked = form.recipients.includes(person.email);
            return (
              <li key={person.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                    checked
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] bg-[var(--surface-2)]",
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--line-strong)]"
                    checked={checked}
                    onChange={() => toggleRecipient(person.email)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.8125rem] font-medium text-[var(--ink)]">{person.name}</span>
                    <span className="block truncate text-[0.6875rem] text-[var(--ink-3)]">
                      {person.email} · {person.roleName}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy}>
          Save notification settings
        </Button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(initial)}>
          Reset
        </button>
      </div>
    </form>
  );
}
