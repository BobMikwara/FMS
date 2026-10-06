"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, FileSpreadsheet, FileCode2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/layout";
import { useToast } from "@/components/ui/feedback";
import { REPORT_CATEGORIES } from "@/lib/report-categories";
import { cn } from "@/lib/utils";
import {
  dateFromDateTimeInputInTimeZone,
  dateTimeInputValueInTimeZone,
  dayStartInTimeZone,
  normalizeTimeZone,
} from "@/server/services/time-zone";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom range" },
];

const FORMATS = [
  { value: "pdf", label: "PDF", hint: "Print-ready document", icon: FileText },
  { value: "excel", label: "Excel", hint: "Opens in Excel / Sheets", icon: FileSpreadsheet },
  { value: "csv", label: "CSV", hint: "Plain text, any tool", icon: FileCode2 },
];

export function ReportForm({
  defaultFrom,
  defaultTo,
  organizationTimeZone,
  stations,
  fuelTypes,
  canExport,
  canViewReports,
}: {
  defaultFrom: string;
  defaultTo: string;
  organizationTimeZone: string;
  stations: { id: string; name: string; timeZone: string }[];
  fuelTypes: { id: string; name: string }[];
  canExport: boolean;
  canViewReports: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    category: "summary",
    period: "weekly",
    dateFrom: dateTimeInputValueInTimeZone(defaultFrom, organizationTimeZone),
    dateTo: dateTimeInputValueInTimeZone(defaultTo, organizationTimeZone),
    format: "pdf",
    stationId: "",
    fuelTypeId: "",
    notes: "",
  });

  const activeTimeZone = normalizeTimeZone(
    stations.find((station) => station.id === form.stationId)?.timeZone,
    organizationTimeZone,
  );

  const selectedCategory = useMemo(
    () => REPORT_CATEGORIES.find((entry) => entry.value === form.category) ?? REPORT_CATEGORIES[0],
    [form.category],
  );

  const applyPeriod = (period: string) => {
    const now = new Date();
    const next = { ...form, period };
    if (period === "today") {
      next.dateFrom = dateTimeInputValueInTimeZone(dayStartInTimeZone(now, 0, activeTimeZone), activeTimeZone);
      next.dateTo = dateTimeInputValueInTimeZone(now, activeTimeZone);
    } else if (period === "daily") {
      const yesterday = dayStartInTimeZone(now, -1, activeTimeZone);
      const today = dayStartInTimeZone(now, 0, activeTimeZone);
      next.dateFrom = dateTimeInputValueInTimeZone(yesterday, activeTimeZone);
      next.dateTo = dateTimeInputValueInTimeZone(new Date(today.getTime() - 1000), activeTimeZone);
    } else if (period === "weekly") {
      next.dateFrom = dateTimeInputValueInTimeZone(dayStartInTimeZone(now, -7, activeTimeZone), activeTimeZone);
      next.dateTo = dateTimeInputValueInTimeZone(now, activeTimeZone);
    } else if (period === "monthly") {
      next.dateFrom = dateTimeInputValueInTimeZone(dayStartInTimeZone(now, -30, activeTimeZone), activeTimeZone);
      next.dateTo = dateTimeInputValueInTimeZone(now, activeTimeZone);
    }
    if (!form.title.trim()) {
      const categoryLabel = (REPORT_CATEGORIES.find((entry) => entry.value === form.category) ?? REPORT_CATEGORIES[0]).label;
      next.title = `${categoryLabel} - ${period === "custom" ? "custom range" : period}`;
    }
    setForm(next);
  };

  const changeStation = (stationId: string) => {
    const nextTimeZone = normalizeTimeZone(
      stations.find((station) => station.id === stationId)?.timeZone,
      organizationTimeZone,
    );
    const from = dateFromDateTimeInputInTimeZone(form.dateFrom, activeTimeZone);
    const to = dateFromDateTimeInputInTimeZone(form.dateTo, activeTimeZone);
    setForm({
      ...form,
      stationId,
      dateFrom: from ? dateTimeInputValueInTimeZone(from, nextTimeZone) : form.dateFrom,
      dateTo: to ? dateTimeInputValueInTimeZone(to, nextTimeZone) : form.dateTo,
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const dateFrom = dateFromDateTimeInputInTimeZone(form.dateFrom, activeTimeZone);
      const dateTo = dateFromDateTimeInputInTimeZone(form.dateTo, activeTimeZone);
      if (!dateFrom || !dateTo) {
        setError("Enter valid local report dates. This time zone skips some clock times during daylight-saving changes.");
        return;
      }
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          category: form.category,
          period: form.period,
          dateFrom: dateFrom.toISOString(),
          dateTo: dateTo.toISOString(),
          format: form.format,
          filters: {
            stationId: form.stationId || null,
            fuelTypeId: form.fuelTypeId || null,
            timeZone: activeTimeZone,
            notes: form.notes.trim() || null,
          },
        }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setReportId(payload.data.id);
        toast.success("Report generated", form.title.trim());
        router.refresh();
      } else {
        setError(payload.error?.message ?? "Could not generate the report.");
      }
    } catch {
      setError("Could not reach the server. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        {error ? <Notice tone="crit" title="Could not generate the report">{error}</Notice> : null}

        {reportId ? (
          <Notice tone="ok" title="Report ready">
            <span className="flex flex-wrap items-center gap-3">
              <span>The report has been generated from live data.</span>
              {canExport ? (
                <>
                  <a className="btn btn-secondary btn-sm" href={`/api/reports/${reportId}/export?format=${form.format}`}>
                    <Download size={14} />
                    Download {form.format.toUpperCase()}
                  </a>
                  <a className="btn btn-ghost btn-sm" href={`/api/reports/${reportId}/export?format=csv`}>
                    Download CSV
                  </a>
                </>
              ) : null}
              {canViewReports ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => router.push("/reports")}>
                  View all reports
                </button>
              ) : null}
            </span>
          </Notice>
        ) : null}

        <section className="card p-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Report</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="report-category" required>
              <Select
                id="report-category"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                options={REPORT_CATEGORIES.map((entry) => ({ value: entry.value, label: entry.label }))}
              />
            </Field>
            <Field label="Title" htmlFor="report-title" required hint="Shown in the reports list and the file name.">
              <Input
                id="report-title"
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Weekly consumption - all stations"
              />
            </Field>
          </div>
          <p className="mt-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">{selectedCategory.description}</p>
        </section>

        <section className="card p-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Period</h2>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {PERIODS.map((period) => (
              <button
                key={period.value}
                type="button"
                onClick={() => applyPeriod(period.value)}
                className={cn("btn btn-sm", form.period === period.value ? "btn-primary" : "btn-secondary")}
                aria-pressed={form.period === period.value}
              >
                {period.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="From (local time)" htmlFor="report-from" required>
              <Input
                id="report-from"
                type="datetime-local"
                required
                value={form.dateFrom}
                onChange={(event) => setForm({ ...form, dateFrom: event.target.value })}
              />
            </Field>
            <Field label="To (local time)" htmlFor="report-to" required>
              <Input
                id="report-to"
                type="datetime-local"
                required
                value={form.dateTo}
                onChange={(event) => setForm({ ...form, dateTo: event.target.value })}
              />
            </Field>
          </div>
          <p className="mt-2 text-[0.75rem] text-[var(--ink-3)]">
            Dates use {activeTimeZone}. They are stored in UTC and rendered in the report using station-local time where available.
          </p>
        </section>

        <section className="card p-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Scope (optional)</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Station" htmlFor="report-station">
              <Select
                id="report-station"
                value={form.stationId}
                onChange={(event) => changeStation(event.target.value)}
                options={[
                  { value: "", label: "All stations" },
                  ...stations.map((station) => ({ value: station.id, label: station.name })),
                ]}
              />
            </Field>
            <Field label="Fuel type" htmlFor="report-fuel">
              <Select
                id="report-fuel"
                value={form.fuelTypeId}
                onChange={(event) => setForm({ ...form, fuelTypeId: event.target.value })}
                options={[
                  { value: "", label: "All fuel types" },
                  ...fuelTypes.map((fuel) => ({ value: fuel.id, label: fuel.name })),
                ]}
              />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Notes" htmlFor="report-notes" hint="Stored with the report so the context is never lost.">
              <Textarea
                id="report-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Prepared for the Monday operations call."
              />
            </Field>
          </div>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <section className="card p-5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Format</h2>
          <div className="mt-3 space-y-2">
            {FORMATS.map((format) => {
              const Icon = format.icon;
              const active = form.format === format.value;
              return (
                <label
                  key={format.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                    active
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--line-strong)]",
                  )}
                >
                  <input
                    type="radio"
                    name="format"
                    className="h-4 w-4"
                    value={format.value}
                    checked={active}
                    onChange={() => setForm({ ...form, format: format.value })}
                  />
                  <Icon size={16} className="shrink-0 text-[var(--ink-2)]" />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-[var(--ink)]">{format.label}</span>
                    <span className="block text-[0.6875rem] text-[var(--ink-3)]">{format.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-2">
          <Button type="submit" loading={busy}>
            Generate report
          </Button>
          {canViewReports ? (
            <Button type="button" variant="secondary" onClick={() => router.push("/reports")}>
              Cancel
            </Button>
          ) : null}
        </div>

        <p className="text-[0.6875rem] leading-relaxed text-[var(--ink-3)]">
          Reports are generated from the same data the dashboard uses. Where a value does not exist - no probe reading yet,
          no tracker attached - the file says “Not available” instead of guessing.
        </p>
      </aside>
    </form>
  );
}
