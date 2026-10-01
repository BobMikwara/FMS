"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn, formatDateTime, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import {
  Badge,
  EmptyState,
  StatusBadge,
  StatusDot,
  alertStatusLabel,
  alertStatusTone,
  tankStatusTone,
  useToast,
} from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/overlay";
import { DataTable, type Column } from "@/components/ui/data-table";
import { AreaChart, type Series } from "@/components/charts/charts";
import { TankBar, TankVisual } from "@/components/charts/tank-visual";
import { FuelReplay } from "@/components/charts/fuel-replay";
import { EventTypeBadge, ConfidenceBadge } from "@/components/domain/badges";
import type { Tank, Station, FuelType, Device, Alert } from "@/server/domain/types";
import { tankStateForPercent } from "@/lib/status";

export interface TankDetailProps {
  tank: Tank;
  station: Pick<Station, "name"> | null;
  fuelType: FuelType | null;
  device: Omit<Device, "apiKeyHash"> | null;
  canViewAlerts: boolean;
  canViewReadings: boolean;
  canViewMovements: boolean;
  canViewDevices: boolean;
  canAcknowledge: boolean;
  canResolve: boolean;
  canNote: boolean;
  detail: {
    fillPercent: number;
    remainingCapacity: number;
    dataState: "live" | "delayed" | "stale" | "offline";
    todayConsumption: number | null;
    todayRefills: number | null;
    coverage: { avgDailyConsumption: number; daysRemaining: number | null } | null;
    reconciliation: {
      openingStock: number;
      refills: number;
      consumption: number;
      expectedClosing: number;
      measured: number;
      variance: number;
      variancePct: number;
      exceedsThreshold: boolean;
    } | null;
    history: { bucket: string; avgVolume: number; avgPercent: number; avgTemp: number; avgWater: number }[];
    events: {
      id: string;
      ts: string;
      type: string;
      volume: number;
      levelBefore: number;
      levelAfter: number;
      confidence: string;
      status: string;
      reason: string | null;
    }[];
    alerts: Alert[];
    readings: {
      id: string;
      ts: string;
      volumeLiters: number;
      levelPercent: number | null;
      temperatureC: number | null;
      waterLevelMm: number | null;
      signal: number | null;
      batteryPct: number | null;
      deviceSerial: string | null;
    }[];
    latestReading: { ts: string; volumeLiters: number } | null;
  };
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "readings", label: "Readings" },
  { id: "movements", label: "Fuel movement" },
  { id: "replay", label: "Usage replay" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "alerts", label: "Alerts" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const DATA_STATE_COPY: Record<string, { label: string; tone: "ok" | "warn" | "crit" | "neutral"; note: string }> = {
  live: { label: "Live", tone: "ok", note: "Receiving readings from the probe right now." },
  delayed: { label: "Delayed", tone: "warn", note: "The most recent reading arrived a few minutes ago." },
  stale: { label: "Stale", tone: "warn", note: "No new readings for a while. The values shown are the last valid readings." },
  offline: { label: "Offline", tone: "crit", note: "The probe is not reporting. The last valid reading is preserved below." },
};

export function TankDetailClient({
  tank,
  station,
  fuelType,
  device,
  detail,
  canViewAlerts,
  canViewReadings,
  canViewMovements,
  canViewDevices,
  canAcknowledge,
  canResolve,
  canNote,
}: TankDetailProps) {
  const [tab, setTab] = useState<TabId>("overview");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteTarget, setNoteTarget] = useState<string>("");
  const [savingNote, setSavingNote] = useState(false);
  const [ackId, setAckId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { id: string; body: string; userName: string; createdAt: string }[]>>({});
  const toast = useToast();

  const canViewReplay = canViewReadings && canViewMovements;
  const visibleTabs = TABS.filter((item) => {
    if (item.id === "readings") return canViewReadings;
    if (item.id === "movements") return canViewMovements;
    if (item.id === "replay" || item.id === "reconciliation") return canViewReplay;
    if (item.id === "alerts") return canViewAlerts;
    return true;
  });
  const state = DATA_STATE_COPY[detail.dataState] ?? DATA_STATE_COPY.offline;
  const latest = detail.latestReading;
  const visualStatus: Tank["status"] =
    !latest && detail.dataState === "offline"
      ? "offline"
      : tankStateForPercent(detail.fillPercent, tank.criticalThresholdPct, tank.lowThresholdPct);

  const chartSeries = useMemo<Series[]>(() => {
    if (detail.history.length < 2) return [];
    return [
      {
        key: "volume",
        label: "Measured volume",
        color: fuelType?.color ?? "#0f766e",
        values: detail.history.map((point) => Math.round(point.avgVolume)),
      },
    ];
  }, [detail.history, fuelType?.color]);

  const refreshNotes = async (alertId: string) => {
    try {
      const response = await fetch(`/api/alerts/${alertId}/notes`);
      const payload = await response.json();
      if (payload.ok) setNotes((prev) => ({ ...prev, [alertId]: payload.data.notes ?? [] }));
    } catch {
      /* notes are non-critical */
    }
  };

  const acknowledge = async (alertId: string) => {
    setAckId(alertId);
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "acknowledge" }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Alert acknowledged");
        window.location.reload();
      } else {
        toast.error(payload.error?.message ?? "Could not acknowledge the alert.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setAckId(null);
    }
  };

  const resolve = async (alertId: string) => {
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve", note: noteBody }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Alert resolved");
        setNoteOpen(false);
        window.location.reload();
      } else {
        toast.error(payload.error?.message ?? "Could not resolve the alert.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    }
  };

  const saveNote = async (alertId: string) => {
    if (!noteBody.trim()) {
      toast.error("Add a short note before saving.");
      return;
    }
    setSavingNote(true);
    try {
      const response = await fetch(`/api/alerts/${alertId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      const payload = await response.json();
      if (payload.ok) {
        setNoteBody("");
        setNoteOpen(false);
        toast.success("Note added");
        refreshNotes(alertId);
      } else {
        toast.error(payload.error?.message ?? "Could not save the note.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-[var(--ink)]">Current status</h2>
              <StatusBadge tone={tankStatusTone(visualStatus)}>{statusLabel(visualStatus)}</StatusBadge>
              <Badge tone={state.tone}>
                <span className="flex items-center gap-1.5">
                  <StatusDot
                    tone={state.tone === "ok" ? "ok" : state.tone === "crit" ? "crit" : "warn"}
                    pulse={detail.dataState === "live"}
                  />
                  {state.label} data
                </span>
              </Badge>
            </div>
            <p className="mt-1.5 max-w-xl text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              {state.note}{" "}
              {latest ? `Last reading ${timeAgo(latest.ts)} (${formatDateTime(latest.ts)}).` : "No readings received yet."}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-[var(--ink-3)]">Measured volume</p>
            <p className="text-num mt-1 text-[1.75rem] font-semibold leading-none tracking-[-0.03em] text-[var(--ink)]">
              {latest ? formatNumber(Math.round(latest.volumeLiters)) : "Not available"}
            </p>
            <p className="mt-1 text-[0.75rem] text-[var(--ink-2)]">
              {latest ? `of ${formatNumber(Math.round(tank.capacity))} L usable` : "Awaiting first reading"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(19rem,22rem)_minmax(0,1fr)]">
          <div className="grid min-w-0 items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            <TankVisual
              name={tank.name}
              fuelType={fuelType?.systemName ?? "fuel"}
              fuelLabel={fuelType?.displayName}
              color={fuelType?.color ?? "#0f766e"}
              volume={latest?.volumeLiters ?? 0}
              capacity={tank.capacity}
              status={visualStatus}
              lowThresholdPct={tank.lowThresholdPct}
              criticalThresholdPct={tank.criticalThresholdPct}
              dataState={detail.dataState}
              size="md"
              showMarkings
            />
            <div className="min-w-0 flex-1 space-y-3">
              <Metric label="Fill level" value={formatPercent(detail.fillPercent, 1)} />
              <Metric label="Free capacity" value={`${formatNumber(Math.round(detail.remainingCapacity))} L`} />
              {canViewMovements && detail.coverage ? (
                <Metric
                  label="Stock coverage"
                  value={detail.coverage.daysRemaining == null ? "Not available" : `${detail.coverage.daysRemaining.toFixed(1)} days`}
                  hint={
                    detail.coverage.avgDailyConsumption > 0
                      ? `${formatNumber(Math.round(detail.coverage.avgDailyConsumption))} L/day average`
                      : "No consumption recorded yet"
                  }
                />
              ) : null}
            </div>
          </div>

          {canViewMovements ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Tile
                label="Fuel consumption / tank outflow (today)"
                value={`${formatNumber(detail.todayConsumption ?? 0)} L`}
                tone="neutral"
              />
              <Tile label="Refills (today)" value={`${formatNumber(detail.todayRefills ?? 0)} L`} tone="ok" />
              {canViewReadings && detail.reconciliation ? (
                <Tile
                  label="Reconciliation variance"
                  value={`${detail.reconciliation.variance > 0 ? "+" : ""}${formatNumber(Math.round(detail.reconciliation.variance))} L`}
                  tone={detail.reconciliation.exceedsThreshold ? "warn" : "neutral"}
                  hint={detail.reconciliation.exceedsThreshold ? "Above the configured threshold" : "Within the configured threshold"}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-[var(--line)]" aria-label="Tank sections">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-2.5 text-[0.8125rem] font-medium transition-colors",
              tab === item.id
                ? "border-[var(--ink)] text-[var(--ink)]"
                : "border-transparent text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="space-y-5">
          {canViewReadings ? (
            <section className="card p-5">
              <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Level trend</h3>
                <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">Measured volume per bucket over the last 7 days.</p>
              </div>
              <Badge tone="neutral">{detail.history.length} points</Badge>
            </div>
            <div className="mt-4">
              {chartSeries.length > 0 ? (
                <AreaChart
                  labels={detail.history.map((point) => point.bucket)}
                  series={chartSeries}
                  height={220}
                  yUnit="L"
                  ariaLabel={`Measured volume trend for ${tank.name}`}
                />
              ) : (
                <EmptyState
                  icon="tank"
                  title="Not enough history yet"
                  description="Once this tank has reported a few readings, the trend chart will appear here."
                />
              )}
            </div>
            </section>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card p-5">
              <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Tank configuration</h3>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Metric label="Station" value={station?.name ?? "Unknown"} />
                <Metric label="Fuel type" value={fuelType?.displayName ?? "Unknown"} />
                <Metric label="Type" value={tank.tankType === "underground" ? "Underground" : "Above ground"} />
                <Metric label="Manufacturer" value={tank.manufacturer || "Not provided"} />
                <Metric label="Low threshold" value={`${tank.lowThresholdPct}%`} />
                <Metric label="Critical threshold" value={`${tank.criticalThresholdPct}%`} />
                <Metric label="Overfill threshold" value={`${tank.overfillThresholdPct}%`} />
                <Metric label="Minimum safe level" value={`${formatNumber(Math.round(tank.minLevel))} L`} />
              </dl>
            </section>

            {canViewDevices ? (
              <section className="card p-5">
                <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Connected device</h3>
              {device ? (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5">
                  <Metric label="Serial number" value={device.serialNumber} />
                  <Metric label="Model" value={device.model || "Not provided"} />
                  <Metric label="Provider" value={device.provider} />
                  <Metric label="Status" value={device.status.replace("_", " ")} />
                  <Metric label="Last seen" value={device.lastSeenAt ? timeAgo(device.lastSeenAt) : "Never"} />
                  <Metric label="Firmware" value={device.firmware || "Unknown"} />
                </dl>
              ) : (
                <EmptyState
                  icon="device"
                  title="No device connected"
                  description="Assign a fuel probe to this tank to start collecting measurements."
                  action={
                    <Link href="/devices" className="btn btn-primary btn-sm">
                      Go to devices
                    </Link>
                  }
                />
              )}
              </section>
            ) : null}
          </div>

          <section className="card p-5">
            <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Other tanks at this station</h3>
            <div className="mt-4">
              <TankBar
                name={tank.name}
                color={fuelType?.color ?? "#0f766e"}
                volume={latest?.volumeLiters ?? 0}
                capacity={tank.capacity}
              />
            </div>
          </section>
        </div>
      ) : null}

      {tab === "readings" ? <ReadingsTable readings={detail.readings} /> : null}
      {tab === "movements" ? <MovementsTable events={detail.events} /> : null}
      {tab === "replay" ? <FuelReplay tankId={tank.id} tankName={tank.name} capacity={tank.capacity} /> : null}

      {tab === "reconciliation" && detail.reconciliation ? (
        <section className="card p-5">
          <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Inventory reconciliation (7 days)</h3>
          <p className="mt-1 max-w-2xl text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
            Opening stock + refills − consumption = expected closing stock. The variance compares the probe's measured
            volume against that expectation. A large variance may indicate an unrecorded delivery, a metering issue or a
            possible leak - investigate before drawing conclusions.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Opening stock" value={`${formatNumber(Math.round(detail.reconciliation.openingStock))} L`} />
            <Metric label="Refills" value={`+${formatNumber(Math.round(detail.reconciliation.refills))} L`} />
            <Metric label="Consumption" value={`−${formatNumber(Math.round(detail.reconciliation.consumption))} L`} />
            <Metric label="Expected closing" value={`${formatNumber(Math.round(detail.reconciliation.expectedClosing))} L`} />
            <Metric label="Probe volume" value={`${formatNumber(Math.round(detail.reconciliation.measured))} L`} />
            <Metric
              label="Variance"
              value={`${detail.reconciliation.variance > 0 ? "+" : ""}${formatNumber(Math.round(detail.reconciliation.variance))} L`}
              hint={`${formatPercent(Math.abs(detail.reconciliation.variancePct), 2)} of expected`}
            />
          </dl>
          {detail.reconciliation.exceedsThreshold ? (
            <p className="mt-4 rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] px-4 py-3 text-[0.8125rem] leading-relaxed text-[var(--ink)]">
              The variance exceeds the configured threshold. Review deliveries, dispensing records and device calibration
              before concluding anything about fuel loss.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === "alerts" ? (
        <AlertsTable
          alerts={detail.alerts}
          notes={notes}
          onAcknowledge={acknowledge}
          onResolve={resolve}
          onOpenNote={(alertId) => {
            setNoteTarget(alertId);
            setNoteBody("");
            setNoteOpen(true);
            refreshNotes(alertId);
          }}
          canAcknowledge={canAcknowledge}
          canResolve={canResolve}
          canNote={canNote}
          ackPending={ackId}
        />
      ) : null}

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add a note"
        description="Notes are visible to everyone with alert access and are recorded in the audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button loading={savingNote} onClick={() => saveNote(noteTarget)}>
              Save note
            </Button>
          </>
        }
      >
        <label htmlFor="note-body" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--ink)]">
          Note
        </label>
        <textarea
          id="note-body"
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          rows={4}
          placeholder="Describe what you observed and any action taken."
          className="field min-h-[6rem]"
        />
      </Modal>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{label}</p>
      <p className="text-num mt-1 truncate text-[0.875rem] font-semibold text-[var(--ink)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{hint}</p> : null}
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone: "ok" | "warn" | "neutral"; hint?: string }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--ink)";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{label}</p>
      <p className="text-num mt-1.5 text-[1.125rem] font-semibold" style={{ color }}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)]">{hint}</p> : null}
    </div>
  );
}

function formatShortTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* -------------------------------------------------------------------------- */
/* Readings table                                                             */
/* -------------------------------------------------------------------------- */

type ReadingRow = TankDetailProps["detail"]["readings"][number];

function ReadingsTable({ readings }: { readings: ReadingRow[] }) {
  const columns: Column<ReadingRow>[] = [
    { key: "ts", header: "Timestamp (UTC)", cell: (row) => <span className="text-num text-[0.8125rem]">{formatDateTime(row.ts)}</span> },
    {
      key: "volumeLiters",
      header: "Volume (L)",
      numeric: true,
      cell: (row) => <span className="text-num font-semibold">{formatNumber(Math.round(row.volumeLiters))}</span>,
    },
    { key: "levelPercent", header: "Level", numeric: true, cell: (row) => (row.levelPercent == null ? "-" : formatPercent(row.levelPercent, 1)) },
    { key: "temperatureC", header: "Temp", numeric: true, hideOnMobile: true, cell: (row) => (row.temperatureC == null ? "-" : `${row.temperatureC.toFixed(1)} °C`) },
    { key: "waterLevelMm", header: "Water", numeric: true, hideOnMobile: true, cell: (row) => (row.waterLevelMm == null ? "-" : `${row.waterLevelMm.toFixed(1)} mm`) },
    { key: "signal", header: "Signal", numeric: true, hideOnMobile: true, cell: (row) => (row.signal == null ? "-" : `${row.signal}`) },
    { key: "batteryPct", header: "Battery", numeric: true, hideOnMobile: true, cell: (row) => (row.batteryPct == null ? "-" : `${row.batteryPct}%`) },
    { key: "deviceSerial", header: "Device", hideOnMobile: true, cell: (row) => row.deviceSerial ?? "-" },
  ];

  if (readings.length === 0) {
    return (
      <EmptyState
        icon="tank"
        title="No readings recorded yet"
        description="This tank has not received any probe measurements. Readings appear here as soon as the device reports."
      />
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Recent raw readings</h3>
          <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
            Stored exactly as reported by the device. Derived events are kept separately.
          </p>
        </div>
        <Badge tone="neutral">Latest {readings.length}</Badge>
      </div>
      <DataTable columns={columns} rows={readings} rowKey={(row) => row.id} dense toolbar={false} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Movements table                                                            */
/* -------------------------------------------------------------------------- */

type EventRow = TankDetailProps["detail"]["events"][number];

function MovementsTable({ events }: { events: EventRow[] }) {
  const [filter, setFilter] = useState("all");
  const rows = filter === "all" ? events : events.filter((event) => event.type === filter);

  const columns: Column<EventRow>[] = [
    { key: "ts", header: "Timestamp", cell: (row) => <span className="text-num text-[0.8125rem]">{formatDateTime(row.ts)}</span> },
    { key: "type", header: "Movement", cell: (row) => <EventTypeBadge type={row.type} /> },
    {
      key: "volume",
      header: "Volume",
      numeric: true,
      cell: (row) => (
        <span className={cn("text-num font-semibold", row.type === "refill" ? "text-[var(--ok)]" : "text-[var(--ink)]")}>
          {row.type === "refill" ? "+" : "−"}
          {formatNumber(Math.round(row.volume))} L
        </span>
      ),
    },
    {
      key: "levels",
      header: "Before → After",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-num text-[0.75rem] text-[var(--ink-2)]">
          {formatNumber(Math.round(row.levelBefore))} → {formatNumber(Math.round(row.levelAfter))} L
        </span>
      ),
    },
    { key: "confidence", header: "Confidence", hideOnMobile: true, cell: (row) => <ConfidenceBadge value={row.confidence} /> },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
        <div>
          <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Fuel movement ledger</h3>
          <p className="mt-0.5 max-w-2xl text-[0.75rem] text-[var(--ink-3)]">
            Refills and tank outflow derived from consecutive readings. Tank outflow is not the same as fuel sold until
            dispenser integration is connected.
          </p>
        </div>
        <Select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter movements"
          className="w-44"
          options={[
            { value: "all", label: "All movements" },
            { value: "refill", label: "Refills only" },
            { value: "consumption", label: "Outflow only" },
            { value: "anomaly", label: "Anomalies only" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon="movement"
          title="No movements in this period"
          description="Refills and consumption are detected automatically once readings show a sustained change."
        />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} dense toolbar={false} />
      )}
    </div>
  );
}



/* -------------------------------------------------------------------------- */
/* Alerts table                                                               */
/* -------------------------------------------------------------------------- */

type AlertRow = Alert;

function AlertsTable({
  alerts,
  notes,
  onAcknowledge,
  onResolve,
  onOpenNote,
  canAcknowledge,
  canResolve,
  canNote,
  ackPending,
}: {
  alerts: AlertRow[];
  notes: Record<string, { id: string; body: string; userName: string; createdAt: string }[]>;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onOpenNote: (id: string) => void;
  canAcknowledge: boolean;
  canResolve: boolean;
  canNote: boolean;
  ackPending: string | null;
}) {
  const columns: Column<AlertRow>[] = [
    {
      key: "severity",
      header: "Severity",
      cell: (row) => (
        <Badge tone={row.severity === "critical" ? "crit" : row.severity === "warning" ? "warn" : "info"}>{row.severity}</Badge>
      ),
    },
    {
      key: "title",
      header: "Alert",
      cell: (row) => <span className="text-[0.8125rem] font-medium text-[var(--ink)]">{row.title}</span>,
    },
    { key: "triggeredAt", header: "Triggered", hideOnMobile: true, cell: (row) => <span className="text-num text-[0.8125rem]">{timeAgo(row.createdAt)}</span> },
    { key: "status", header: "Status", cell: (row) => <StatusBadge tone={alertStatusTone(row.status)}>{alertStatusLabel(row.status)}</StatusBadge> },
    {
      key: "actions",
      header: "",
      cell: (row) => canNote || (row.status === "active" && canAcknowledge) || (row.status !== "resolved" && canResolve) ? (
        <div className="flex items-center justify-end gap-2">
          {canNote ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenNote(row.id)}>
              Note
            </Button>
          ) : null}
          {row.status === "active" && canAcknowledge ? (
            <Button size="sm" variant="secondary" loading={ackPending === row.id} onClick={() => onAcknowledge(row.id)}>
              Acknowledge
            </Button>
          ) : null}
          {row.status !== "resolved" && canResolve ? (
            <Button size="sm" variant="primary" onClick={() => onResolve(row.id)}>
              Resolve
            </Button>
          ) : null}
        </div>
      ) : null,
    },
  ];

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon="alert"
        title="No alerts for this tank"
        description="Alerts are created automatically from your configured rules. Nothing has been triggered here yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <DataTable columns={columns} rows={alerts} rowKey={(row) => row.id} toolbar={false} />
      </div>
      {Object.keys(notes).length > 0 ? (
        <div className="card px-5 py-4">
          <h4 className="text-[0.75rem] font-semibold text-[var(--ink)]">Notes</h4>
          <ul className="mt-3 space-y-3">
            {Object.entries(notes).flatMap(([alertId, list]) =>
              list.map((note) => (
                <li key={note.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
                  <p className="text-[0.8125rem] leading-relaxed text-[var(--ink)]">{note.body}</p>
                  <p className="mt-1.5 text-[0.6875rem] text-[var(--ink-3)]">
                    {note.userName} · {timeAgo(note.createdAt)} · alert {alertId.slice(-6)}
                  </p>
                </li>
              )),
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status: Tank["status"]) {
  return status === "full" ? "Full" : status === "normal" ? "Normal" : status === "low" ? "Low" : status === "critical" ? "Critical" : "Offline";
}

export { formatShortTime };
