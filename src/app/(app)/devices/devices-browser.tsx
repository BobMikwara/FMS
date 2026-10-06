"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DataTable, actionsColumn, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { DeviceStatusBadge } from "@/components/domain/badges";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { ConfirmDialog, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";

interface DeviceRow {
  id: string;
  type: "fuel_probe" | "gps_tracker";
  serialNumber: string;
  label: string | null;
  provider: string;
  model: string | null;
  firmware: string | null;
  stationId: string | null;
  tankId: string | null;
  vehicleId: string | null;
  status: "online" | "delayed" | "offline" | "fault" | "never_connected";
  isActive: boolean;
  lastSeenAt: string | null;
  lastReadingAt: string | null;
  signalStrength: number | null;
  batteryPct: number | null;
  stationName: string | null;
  tankName: string | null;
  vehicleName: string | null;
}

export function DevicesBrowser({
  initialRows,
  canCreate,
  canEdit,
  canRetire,
}: {
  initialRows: DeviceRow[];
  canCreate: boolean;
  canEdit: boolean;
  canRetire: boolean;
}) {
  const query = useResourceQuery<DeviceRow>({
    endpoint: "/api/devices",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 25 },
    pageSize: 25,
  });
  const [retireId, setRetireId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const toast = useToast();

  const rows = query.rows as DeviceRow[];
  const target = rows.find((row) => row.id === retireId) ?? null;
  const rotateTarget = rows.find((row) => row.id === rotateId) ?? null;

  const retire = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/devices/${target.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Device retired", `${target.serialNumber} will no longer submit readings.`);
        setRetireId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not retire the device.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (device: DeviceRow) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/devices/${device.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: true, status: device.lastSeenAt ? "offline" : "never_connected" }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Device restored", `${device.serialNumber} can submit readings again.`);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not restore the device.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!rotateTarget) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/devices/${rotateTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rotateApiKey: true }),
      });
      const payload = await response.json();
      if (payload.ok) {
        // The raw key exists only in this response, so it is surfaced immediately.
        setRotatedKey(payload.data.apiKey as string);
        toast.success("Ingest key rotated", `${rotateTarget.serialNumber} needs the new key installed before it can report again.`);
      } else {
        toast.error(payload.error?.message ?? "Could not rotate the key.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
      setRotateId(null);
    }
  };

  const columns: Column<DeviceRow>[] = useMemo(
    () => [
      {
        key: "serialNumber",
        header: "Device",
        minWidth: 168,
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{row.serialNumber}</p>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {row.label ? `${row.label} · ` : ""}
              {row.provider}
              {row.model ? ` · ${row.model}` : ""}
            </p>
          </div>
        ),
      },
      {
        key: "type",
        header: "Type",
        minWidth: 112,
        cell: (row) => (
          <span className="badge badge-neutral">{row.type === "fuel_probe" ? "Fuel probe" : "GPS tracker"}</span>
        ),
      },
      {
        key: "assignment",
        header: "Assigned to",
        minWidth: 128,
        cell: (row) =>
          row.type === "fuel_probe" ? (
            row.tankName ? (
              <Link href={`/tanks/${row.tankId}`} className="text-[0.8125rem] text-[var(--brand)] hover:underline">
                {row.tankName}
              </Link>
            ) : (
              <span className="text-[0.75rem] text-[var(--ink-3)]">Not assigned</span>
            )
          ) : row.vehicleName ? (
            <Link href="/vehicles" className="text-[0.8125rem] text-[var(--brand)] hover:underline">
              {row.vehicleName}
            </Link>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">Not assigned</span>
          ),
      },
      {
        key: "status",
        header: "Status",
        minWidth: 96,
        cell: (row) => row.isActive
          ? <DeviceStatusBadge status={row.status} />
          : <span className="badge badge-neutral">Retired</span>,
      },
      {
        key: "lastSeen",
        header: "Last seen",
        minWidth: 100,
        hideOnMobile: true,
        cell: (row) =>
          row.lastSeenAt ? (
            <span className="text-num text-[0.75rem] text-[var(--ink-2)]">{timeAgo(row.lastSeenAt)}</span>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">Never</span>
          ),
      },
      {
        key: "signal",
        header: "Signal",
        minWidth: 76,
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (row.signalStrength == null ? "-" : `${row.signalStrength}`),
      },
      {
        key: "battery",
        header: "Battery",
        minWidth: 84,
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (row.batteryPct == null ? "-" : `${row.batteryPct}%`),
      },
      // Only offered when the user can act on a device, so the heading never sits over an empty column.
      ...(canEdit || canRetire
        ? [
            actionsColumn<DeviceRow>(
              (row) => (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {canEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => setRotateId(row.id)}>
                      Rotate key
                    </Button>
                  ) : null}
                  {canRetire && row.isActive ? (
                    <Button size="sm" variant="ghost" onClick={() => setRetireId(row.id)}>
                      Retire
                    </Button>
                  ) : null}
                  {canEdit && !row.isActive ? (
                    <Button size="sm" variant="ghost" onClick={() => restore(row)} loading={busy}>
                      Restore
                    </Button>
                  ) : null}
                </div>
              ),
              { minWidth: 156 },
            ),
          ]
        : []),
    ],
    [busy, canEdit, canRetire, restore],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by type"
          className="w-40"
          value={query.filters.type ?? ""}
          onChange={(event) => query.setFilter("type", event.target.value)}
          options={[
            { value: "", label: "All types" },
            { value: "fuel_probe", label: "Fuel probes" },
            { value: "gps_tracker", label: "GPS trackers" },
          ]}
        />
        <Select
          aria-label="Filter by status"
          className="w-44"
          value={query.filters.status ?? ""}
          onChange={(event) => query.setFilter("status", event.target.value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "online", label: "Online" },
            { value: "delayed", label: "Delayed" },
            { value: "offline", label: "Offline" },
            { value: "fault", label: "Fault" },
            { value: "never_connected", label: "Never connected" },
          ]}
        />
        <Select
          aria-label="Filter active or retired devices"
          className="w-40"
          value={query.filters.active ?? ""}
          onChange={(event) => query.setFilter("active", event.target.value)}
          options={[
            { value: "", label: "All devices" },
            { value: "true", label: "Active devices" },
            { value: "false", label: "Retired devices" },
          ]}
        />
        <Select
          aria-label="Filter by reporting state"
          className="w-48"
          value={query.filters.reporting ?? ""}
          onChange={(event) => query.setFilter("reporting", event.target.value)}
          options={[
            { value: "", label: "All devices" },
            { value: "ok", label: "Reporting" },
            { value: "problem", label: "Not reporting" },
          ]}
        />
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="devices"
          disabled={query.loading}
          columns={[
            { header: "Serial number", value: (row) => row.serialNumber },
            { header: "Type", value: (row) => row.type },
            { header: "Provider", value: (row) => row.provider },
            { header: "Model", value: (row) => row.model ?? "" },
            { header: "Firmware", value: (row) => row.firmware ?? "" },
            { header: "Station", value: (row) => row.stationName ?? "" },
            { header: "Tank", value: (row) => row.tankName ?? "" },
            { header: "Vehicle", value: (row) => row.vehicleName ?? "" },
            { header: "Status", value: (row) => row.isActive ? row.status : "retired" },
            { header: "Active", value: (row) => row.isActive ? "Yes" : "No" },
            { header: "Last seen", value: (row) => row.lastSeenAt ?? "" },
            { header: "Signal", value: (row) => row.signalStrength ?? "" },
            { header: "Battery (%)", value: (row) => row.batteryPct ?? "" },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="device"
          title="No devices have been registered yet"
          description="Fuel probes and GPS trackers feed the platform. Register a device and assign it to a tank or vehicle."
          action={canCreate ? (
            <Link href="/devices/new" className="btn btn-primary btn-sm">
              Register device
            </Link>
          ) : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={query.loading}
          total={query.total}
          page={query.page}
          pageSize={query.pageSize}
          onPageChange={query.setPage}
          onSortChange={query.setSort}
          sort={query.sort}
          order={query.order}
          onSearch={query.setSearch}
          searchValue={query.search}
          searchPlaceholder="Search devices by serial, provider or assignment…"
          emptyTitle="No devices have been registered yet"
          emptyDescription="Register a device to start collecting readings."
          emptyAction={canCreate ? (
            <Link href="/devices/new" className="btn btn-primary btn-sm">
              Register device
            </Link>
          ) : undefined}
        />
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setRetireId(null)}
        onConfirm={retire}
        title="Retire this device?"
        message={`${target?.serialNumber ?? "This device"} will stop submitting readings. Its reading history is preserved and it can be re-activated later.`}
        confirmLabel="Retire device"
        loading={busy}
      />

      <ConfirmDialog
        open={Boolean(rotateTarget)}
        onClose={() => setRotateId(null)}
        onConfirm={rotate}
        title="Rotate the ingest key?"
        message={`${rotateTarget?.serialNumber ?? "This device"} will stop reporting until the new key is installed on the hardware. The current key stops working immediately.`}
        confirmLabel="Rotate key"
        loading={busy}
      />

      <Modal
        open={Boolean(rotatedKey)}
        onClose={() => setRotatedKey(null)}
        title="New ingest key"
        description="Copy this key into the probe configuration now. It is not stored in readable form and cannot be shown again."
      >
        <code className="block break-all rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[0.75rem] text-[var(--ink)]">
          {rotatedKey}
        </code>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={async () => {
              if (!rotatedKey) return;
              try {
                await navigator.clipboard.writeText(rotatedKey);
                toast.success("Key copied", "Install it on the device to resume reporting.");
              } catch {
                toast.warn("Could not copy", "Select the key manually and copy it.");
              }
            }}
          >
            Copy key
          </Button>
          <Button variant="primary" type="button" onClick={() => setRotatedKey(null)}>
            Done
          </Button>
        </div>
      </Modal>
    </div>
  );
}
