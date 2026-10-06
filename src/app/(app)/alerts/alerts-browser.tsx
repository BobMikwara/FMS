"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { DataTable, actionsColumn, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { AlertSeverityBadge, AlertStatusBadge } from "@/components/domain/badges";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";

interface AlertRow {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  status: "active" | "acknowledged" | "resolved";
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  stationId: string;
  stationName: string | null;
  tankId: string | null;
  tankName: string | null;
  value: number | null;
  unit: string | null;
  threshold: number | null;
}

const TYPE_LABELS: Record<string, string> = {
  critical_fuel: "Critical fuel level",
  low_fuel: "Low fuel level",
  high_fuel: "High fuel level",
  overfill: "Overfill risk",
  water_detected: "Water detected",
  high_temperature: "High temperature",
  probe_offline: "Probe offline",
  refill: "Refill detected",
  unexpected_refuel: "Unexpected refuel",
  suspected_loss: "Suspected loss",
  reconciliation_variance: "Reconciliation variance",
  device_offline: "Device offline",
  device_online: "Device back online",
  rapid_change: "Rapid level change",
};

export function AlertsBrowser({
  initialRows,
  stations,
  canAcknowledge,
  canResolve,
  canNote,
  canViewRules,
}: {
  initialRows: AlertRow[];
  stations: { id: string; name: string }[];
  canAcknowledge: boolean;
  canResolve: boolean;
  canNote: boolean;
  canViewRules: boolean;
}) {
  const query = useResourceQuery<AlertRow>({
    endpoint: "/api/alerts",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 20 },
    pageSize: 20,
  });
  const [resolveTarget, setResolveTarget] = useState<AlertRow | null>(null);
  const [noteTarget, setNoteTarget] = useState<AlertRow | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const rows = query.rows as AlertRow[];

  const act = async (alert: AlertRow, action: "acknowledge" | "resolve", note?: string) => {
    setBusyId(alert.id);
    try {
      const response = await fetch(`/api/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(action === "resolve" ? "Alert resolved" : "Alert acknowledged");
        setResolveTarget(null);
        setResolveNote("");
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? `Could not ${action} the alert.`);
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const saveNote = async () => {
    if (!noteTarget || !noteBody.trim()) {
      toast.error("Add a short note before saving.");
      return;
    }
    setBusyId(noteTarget.id);
    try {
      const response = await fetch(`/api/alerts/${noteTarget.id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Note added");
        setNoteTarget(null);
        setNoteBody("");
      } else {
        toast.error(payload.error?.message ?? "Could not save the note.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AlertRow>[] = useMemo(
    () => [
      { key: "severity", header: "Severity", minWidth: 96, cell: (row) => <AlertSeverityBadge severity={row.severity} /> },
      {
        key: "title",
        header: "Alert",
        minWidth: 240,
        cell: (row) => (
          <div className="min-w-0 max-w-[26rem]">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{row.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{row.message}</p>
            <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)]">
              {TYPE_LABELS[row.type] ?? row.type}
              {row.value != null && row.unit ? ` · ${row.value}${row.unit}` : ""}
              {row.threshold != null && row.unit ? ` (threshold ${row.threshold}${row.unit})` : ""}
            </p>
          </div>
        ),
      },
      {
        key: "location",
        header: "Location",
        minWidth: 140,
        hideOnMobile: true,
        cell: (row) => (
          <div>
            {row.tankId ? (
              <Link href={`/tanks/${row.tankId}`} className="block truncate text-[0.8125rem] text-[var(--brand)] hover:underline">
                {row.tankName ?? "View tank"}
              </Link>
            ) : null}
            <Link href={`/stations/${row.stationId}`} className="block truncate text-[0.75rem] text-[var(--ink-3)] hover:underline">
              {row.stationName ?? "View station"}
            </Link>
          </div>
        ),
      },
      {
        key: "createdAt",
        header: "Raised",
        minWidth: 116,
        hideOnMobile: true,
        cell: (row) => (
          <div>
            <p className="text-num text-[0.75rem] text-[var(--ink-2)]">{timeAgo(row.createdAt)}</p>
            {row.resolvedAt ? <p className="mt-0.5 text-[0.6875rem] text-[var(--ok)]">Resolved {timeAgo(row.resolvedAt)}</p> : null}
          </div>
        ),
      },
      { key: "status", header: "Status", minWidth: 132, cell: (row) => <AlertStatusBadge status={row.status} /> },
      // Only offered when the user can act on an alert, so the heading never sits over an empty column.
      ...(canNote || canAcknowledge || canResolve
        ? [
            actionsColumn<AlertRow>(
              (row) =>
                canNote || (row.status === "active" && canAcknowledge) || (row.status !== "resolved" && canResolve) ? (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {canNote ? (
                      <Button size="sm" variant="ghost" onClick={() => { setNoteTarget(row); setNoteBody(""); }}>
                        Note
                      </Button>
                    ) : null}
                    {row.status === "active" && canAcknowledge ? (
                      <Button size="sm" variant="secondary" loading={busyId === row.id} onClick={() => act(row, "acknowledge")}>
                        Acknowledge
                      </Button>
                    ) : null}
                    {row.status !== "resolved" && canResolve ? (
                      <Button size="sm" variant="primary" onClick={() => { setResolveTarget(row); setResolveNote(row.resolutionNote ?? ""); }}>
                        Resolve
                      </Button>
                    ) : null}
                  </div>
                ) : null,
              { minWidth: 232 },
            ),
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId, canAcknowledge, canNote, canResolve, canViewRules],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by status"
          className="w-44"
          value={query.filters.status ?? ""}
          onChange={(event) => query.setFilter("status", event.target.value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "acknowledged", label: "Acknowledged" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
        <Select
          aria-label="Filter by severity"
          className="w-40"
          value={query.filters.severity ?? ""}
          onChange={(event) => query.setFilter("severity", event.target.value)}
          options={[
            { value: "", label: "All severities" },
            { value: "critical", label: "Critical" },
            { value: "warning", label: "Warning" },
            { value: "info", label: "Info" },
          ]}
        />
        <Select
          aria-label="Filter by station"
          className="w-52"
          value={query.filters.stationId ?? ""}
          onChange={(event) => query.setFilter("stationId", event.target.value)}
          options={[
            { value: "", label: "All stations" },
            ...stations.map((station) => ({ value: station.id, label: station.name })),
          ]}
        />
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="alerts"
          disabled={query.loading}
          columns={[
            { header: "Triggered", value: (row) => row.createdAt },
            { header: "Severity", value: (row) => row.severity },
            { header: "Type", value: (row) => row.type },
            { header: "Title", value: (row) => row.title },
            { header: "Message", value: (row) => row.message },
            { header: "Station", value: (row) => row.stationName ?? row.stationId },
            { header: "Tank", value: (row) => row.tankName ?? "" },
            { header: "Value", value: (row) => row.value ?? "" },
            { header: "Threshold", value: (row) => row.threshold ?? "" },
            { header: "Status", value: (row) => row.status },
            { header: "Acknowledged", value: (row) => row.acknowledgedAt ?? "" },
            { header: "Resolved", value: (row) => row.resolvedAt ?? "" },
            { header: "Resolution note", value: (row) => row.resolutionNote ?? "" },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="alert"
          title="No alerts match your filters"
          description="Try a different status, severity or station. You can also tune the rules that raise alerts."
          action={canViewRules ? (
            <Link href="/alerts/rules" className="btn btn-secondary btn-sm">
              Review alert rules
            </Link>
          ) : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          mobileCard={(row) => (
            <article className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-[var(--ink)]">{row.title}</p>
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{row.message}</p>
                </div>
                <AlertSeverityBadge severity={row.severity} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-[var(--ink-3)]">
                <AlertStatusBadge status={row.status} />
                <span>{row.stationName ?? "Unknown station"}</span>
                {row.tankName ? <span>{row.tankName}</span> : null}
                <span>{timeAgo(row.createdAt)}</span>
              </div>
              {canNote || (row.status === "active" && canAcknowledge) || (row.status !== "resolved" && canResolve) ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {canNote ? (
                    <Button size="sm" variant="ghost" onClick={() => { setNoteTarget(row); setNoteBody(""); }}>
                      Note
                    </Button>
                  ) : null}
                  {row.status === "active" && canAcknowledge ? (
                    <Button size="sm" variant="secondary" loading={busyId === row.id} onClick={() => act(row, "acknowledge")}>
                      Acknowledge
                    </Button>
                  ) : null}
                  {row.status !== "resolved" && canResolve ? (
                    <Button size="sm" variant="primary" onClick={() => { setResolveTarget(row); setResolveNote(row.resolutionNote ?? ""); }}>
                      Resolve
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          )}
          loading={query.loading}
          total={query.total}
          page={query.page}
          pageSize={query.pageSize}
          onPageChange={query.setPage}
          onSearch={query.setSearch}
          searchValue={query.search}
          searchPlaceholder="Search alerts by title, message or type…"
          emptyTitle="No alerts"
          emptyDescription="Nothing has been triggered yet."
        />
      )}

      <Modal
        open={Boolean(resolveTarget)}
        onClose={() => setResolveTarget(null)}
        title="Resolve alert"
        description={`${resolveTarget?.title ?? ""} - add a note so the next operator understands what happened.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={busyId === resolveTarget?.id}
              onClick={() => resolveTarget && act(resolveTarget, "resolve", resolveNote.trim() || undefined)}
            >
              Resolve alert
            </Button>
          </>
        }
      >
        <label htmlFor="resolve-note" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--ink)]">
          Resolution note
        </label>
        <Textarea
          id="resolve-note"
          rows={4}
          value={resolveNote}
          onChange={(event) => setResolveNote(event.target.value)}
          placeholder="What was the root cause and what action was taken?"
        />
      </Modal>

      <Modal
        open={Boolean(noteTarget)}
        onClose={() => setNoteTarget(null)}
        title="Add a note"
        description={`Notes on ${noteTarget?.title ?? "this alert"} are visible to everyone with alert access.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteTarget(null)}>
              Cancel
            </Button>
            <Button loading={busyId === noteTarget?.id} onClick={saveNote}>
              Save note
            </Button>
          </>
        }
      >
        <label htmlFor="alert-note" className="mb-1.5 block text-[0.8125rem] font-medium text-[var(--ink)]">
          Note
        </label>
        <Textarea
          id="alert-note"
          rows={4}
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          placeholder="Describe what you observed and any action taken."
        />
      </Modal>
    </div>
  );
}
