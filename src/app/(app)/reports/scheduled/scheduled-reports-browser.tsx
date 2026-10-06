"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Clock, Mail, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";
import { timeAgo } from "@/lib/utils";
import { formatDateTimeInTimeZone } from "@/server/services/time-zone";
import { REPORT_CATEGORIES } from "@/lib/report-categories";

interface ScheduledRow {
  id: string;
  name: string;
  category: string;
  period: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  timezone: string;
  recipients: string[];
  format: string;
  stationId: string | null;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus?: "queued" | "running" | "ready" | "failed" | null;
  lastRunError?: string | null;
  lastRunDeliveries?: Record<string, number>;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const FORMAT_OPTIONS = [
  { value: "pdf", label: "Print-ready HTML" },
  { value: "excel", label: "Excel" },
  { value: "csv", label: "CSV" },
];

function cadenceLabel(row: ScheduledRow): string {
  if (row.period === "daily") return `Every day at ${row.timeOfDay}`;
  if (row.period === "weekly") {
    const day = row.dayOfWeek != null ? DAYS[row.dayOfWeek] : "Monday";
    return `Every ${day} at ${row.timeOfDay}`;
  }
  return `Day ${row.dayOfMonth ?? 1} of every month at ${row.timeOfDay}`;
}

function deliverySummary(counts: Record<string, number> = {}): string {
  return ["delivered", "queued", "sending", "failed", "cancelled"]
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${counts[status]} ${status}`)
    .join(", ");
}

export function ScheduledReportsBrowser({
  initialRows,
  stationOptions,
  allowAllStations,
  operational = true,
  canManage = false,
}: {
  initialRows: ScheduledRow[];
  stationOptions: { id: string; name: string }[];
  allowAllStations: boolean;
  operational?: boolean;
  canManage?: boolean;
}) {
  const [rows, setRows] = useState<ScheduledRow[]>(initialRows);
  const [editTarget, setEditTarget] = useState<ScheduledRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const [form, setForm] = useState({
    name: "",
    category: "consumption",
    period: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    timeOfDay: "07:00",
    format: "pdf",
    stationId: allowAllStations ? "" : (stationOptions[0]?.id ?? ""),
    recipients: "",
    isEnabled: true,
  });

  const openEdit = (row: ScheduledRow) => {
    setEditTarget(row);
    setForm({
      name: row.name,
      category: row.category,
      period: row.period,
      dayOfWeek: row.dayOfWeek ?? 1,
      dayOfMonth: row.dayOfMonth ?? 1,
      timeOfDay: row.timeOfDay,
      format: row.format,
      stationId: row.stationId ?? "",
      recipients: row.recipients.join(", "),
      isEnabled: row.isEnabled,
    });
  };

  const openNew = () => {
    setEditTarget({
      id: "",
      name: "",
      category: "consumption",
      period: "weekly",
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeOfDay: "07:00",
      timezone: "Africa/Dar_es_Salaam",
      recipients: [],
      format: "pdf",
      stationId: null,
      isEnabled: true,
      lastRunAt: null,
      nextRunAt: null,
    });
    setForm({
      name: "",
      category: "consumption",
      period: "weekly",
      dayOfWeek: 1,
      dayOfMonth: 1,
      timeOfDay: "07:00",
      format: "pdf",
      stationId: allowAllStations ? "" : (stationOptions[0]?.id ?? ""),
      recipients: "",
      isEnabled: true,
    });
  };

  const save = async () => {
    const isNew = editTarget?.id === "";
    setBusy(true);
    try {
      const payloadBody = {
        name: form.name.trim(),
        category: form.category,
        period: form.period,
        dayOfWeek: form.period === "weekly" ? form.dayOfWeek : null,
        dayOfMonth: form.period === "monthly" ? form.dayOfMonth : null,
        timeOfDay: form.timeOfDay,
        format: form.format,
        stationId: form.stationId || null,
        recipients: form.recipients
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        isEnabled: form.isEnabled,
      };
      const response = await fetch(isNew ? "/api/scheduled-reports" : `/api/scheduled-reports/${editTarget?.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadBody),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(isNew ? "Schedule created" : "Schedule updated", form.name.trim());
        if (isNew) {
          setRows((current) => [...current, payload.data]);
        } else {
          setRows((current) => current.map((row) => (row.id === payload.data.id ? payload.data : row)));
        }
        setEditTarget(null);
      } else {
        toast.error(payload.error?.message ?? "Could not save the schedule.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: ScheduledRow) => {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/scheduled-reports/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isEnabled: !row.isEnabled }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setRows((current) => current.map((entry) => (entry.id === row.id ? payload.data as ScheduledRow : entry)));
        toast.success(row.isEnabled ? "Schedule paused" : "Schedule resumed", row.name);
      } else {
        toast.error(payload.error?.message ?? "Could not update the schedule.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const stationName = useMemo(
    () => new Map(stationOptions.map((station) => [station.id, station.name])),
    [stationOptions],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-[var(--ink-2)]">
          {operational
            ? `${rows.filter((row) => row.isEnabled).length} of ${rows.length} schedules active.`
            : `${rows.length} saved definitions. Automatic execution is unavailable.`}
        </p>
        {operational && canManage ? (
          <Button size="sm" onClick={openNew}>
            Schedule a report
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[0.875rem] font-medium text-[var(--ink)]">No saved schedule definitions</p>
          <p className="mx-auto mt-2 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {operational
              ? canManage ? "Create a schedule to generate reports on a recurring cadence." : "No scheduled reports are visible in your station scope."
              : "Automatic report execution is not available."}
          </p>
          {operational && canManage ? (
            <div className="mt-4">
              <Button size="sm" onClick={openNew}>
                Schedule a report
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[0.875rem] font-semibold text-[var(--ink)]">{row.name}</h3>
                    <Badge tone={operational && row.isEnabled ? "ok" : "neutral"}>
                      {operational ? (row.isEnabled ? "Active" : "Paused") : "Not running"}
                    </Badge>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-[var(--ink-3)]">
                    <Clock size={12} />
                    Configured cadence: {cadenceLabel(row)} · {row.timezone}
                  </p>
                  <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
                    {(REPORT_CATEGORIES.find((entry) => entry.value === row.category)?.label ?? row.category)} ·{" "}
                    {row.format === "pdf" ? "Print-ready HTML" : row.format.toUpperCase()} ·{" "}
                    {row.stationId ? stationName.get(row.stationId) ?? "Unknown station" : "All stations"}
                  </p>
                  {canManage ? row.recipients.length > 0 ? (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-[var(--ink-2)]">
                      <Mail size={12} className="shrink-0 text-[var(--ink-3)]" />
                      Recipients: {row.recipients.join(", ")}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[0.75rem] text-[var(--warn)]">No email recipients are configured.</p>
                  ) : null}
                  <p className="mt-1.5 text-[0.6875rem] text-[var(--ink-3)]">
                    {row.lastRunAt ? `Last run ${timeAgo(row.lastRunAt)}` : "No execution history"}
                    {row.lastRunStatus ? ` · ${row.lastRunStatus}` : ""}
                    {row.lastRunAt && row.lastRunDeliveries && deliverySummary(row.lastRunDeliveries)
                      ? ` · email ${deliverySummary(row.lastRunDeliveries)}`
                      : ""}
                    {operational && row.nextRunAt && row.isEnabled
                      ? ` · next ${formatDateTimeInTimeZone(row.nextRunAt, row.timezone)} (${row.timezone})`
                      : operational ? "" : " · automatic execution unavailable"}
                  </p>
                  {row.lastRunError ? (
                    <p className="mt-1 text-[0.6875rem] text-[var(--crit)]">Last run error: {row.lastRunError}</p>
                  ) : null}
                </div>
                {operational && canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busyId === row.id}
                      onClick={() => toggle(row)}
                    >
                      {row.isEnabled ? <Pause size={14} /> : <Play size={14} />}
                      {row.isEnabled ? "Pause" : "Resume"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                      Edit
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={editTarget?.id === "" ? "Schedule a report" : "Edit schedule"}
        description="The scheduler creates a report for each due run and queues one email attachment per recipient."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={save}>
              {editTarget?.id === "" ? "Create schedule" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="schedule-name" required className="sm:col-span-2">
            <Input
              id="schedule-name"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Weekly consumption - all stations"
            />
          </Field>
          <Field label="Category" htmlFor="schedule-category" required>
            <Select
              id="schedule-category"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              options={REPORT_CATEGORIES.map((entry) => ({ value: entry.value, label: entry.label }))}
            />
          </Field>
          <Field label="Format" htmlFor="schedule-format" required>
            <Select
              id="schedule-format"
              value={form.format}
              onChange={(event) => setForm({ ...form, format: event.target.value })}
              options={FORMAT_OPTIONS}
            />
          </Field>
          <Field label="Cadence" htmlFor="schedule-period" required>
            <Select
              id="schedule-period"
              value={form.period}
              onChange={(event) => setForm({ ...form, period: event.target.value as ScheduledRow["period"] })}
              options={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
          </Field>
          <Field label="Time" htmlFor="schedule-time" required hint="Uses the selected station time zone, or the organization time zone for all-station schedules.">
            <Input
              id="schedule-time"
              type="time"
              required
              value={form.timeOfDay}
              onChange={(event) => setForm({ ...form, timeOfDay: event.target.value })}
            />
          </Field>
          {form.period === "weekly" ? (
            <Field label="Day of week" htmlFor="schedule-dow" required>
              <Select
                id="schedule-dow"
                value={String(form.dayOfWeek)}
                onChange={(event) => setForm({ ...form, dayOfWeek: Number(event.target.value) })}
                options={DAYS.map((day, index) => ({ value: String(index), label: day }))}
              />
            </Field>
          ) : null}
          {form.period === "monthly" ? (
            <Field label="Day of month" htmlFor="schedule-dom" required hint="Shorter months run on their final calendar day when needed.">
              <Input
                id="schedule-dom"
                type="number"
                min={1}
                max={31}
                value={form.dayOfMonth}
                onChange={(event) => setForm({ ...form, dayOfMonth: Number(event.target.value) })}
              />
            </Field>
          ) : null}
          <Field label="Station" htmlFor="schedule-station" className="sm:col-span-2">
            <Select
              id="schedule-station"
              value={form.stationId}
              onChange={(event) => setForm({ ...form, stationId: event.target.value })}
              options={[
                ...(allowAllStations ? [{ value: "", label: "All stations" }] : []),
                ...stationOptions.map((station) => ({ value: station.id, label: station.name })),
              ]}
            />
          </Field>
          <Field
            label="Recipients"
            htmlFor="schedule-recipients"
            required
            className="sm:col-span-2"
            hint="Add 1 to 10 comma-separated email addresses. Each recipient gets an attachment with its own delivery status."
          >
            <Textarea
              id="schedule-recipients"
              required
              rows={2}
              value={form.recipients}
              onChange={(event) => setForm({ ...form, recipients: event.target.value })}
              placeholder="ops@puma.co.tz, finance@puma.co.tz"
            />
          </Field>
          <div className="sm:col-span-2">
            <Switch
              checked={form.isEnabled}
              onChange={(value) => setForm({ ...form, isEnabled: value })}
              label="Schedule is active"
              description="Pause a schedule without deleting it."
            />
          </div>
        </div>
      </Modal>

    </div>
  );
}
