"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DataTable, actionsColumn, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { VehicleStatusBadge } from "@/components/domain/badges";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";

interface Tracker {
  serialNumber: string;
  status: string;
  lastSeenAt: string | null;
}

interface VehicleRow {
  id: string;
  name: string;
  plateNumber: string;
  type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelTypeId: string | null;
  tankCapacity: number | null;
  stationId: string | null;
  status: "active" | "maintenance" | "inactive";
  isArchived: boolean;
  odometerKm: number | null;
  driverName: string | null;
  driverPhone: string | null;
  tracker: Tracker | null;
}

export function VehiclesBrowser({
  initialRows,
  canCreate,
  canEdit,
  canArchive,
  canViewDevices,
}: {
  initialRows: VehicleRow[];
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canViewDevices: boolean;
}) {
  const query = useResourceQuery<VehicleRow>({
    endpoint: "/api/vehicles",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 25 },
    pageSize: 25,
  });
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = query.rows as VehicleRow[];
  const target = rows.find((row) => row.id === archiveId) ?? null;

  const updateArchiveState = async () => {
    if (!target) return;
    const restoring = target.isArchived;
    setBusy(true);
    try {
      const response = await fetch(`/api/vehicles/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isArchived: !restoring }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(restoring ? "Vehicle restored" : "Vehicle archived", `${target.plateNumber}`);
        setArchiveId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? (restoring ? "Could not restore the vehicle." : "Could not archive the vehicle."));
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<VehicleRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Vehicle",
        minWidth: 170,
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{row.name}</p>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {row.plateNumber} · {row.type}
              {row.make ? ` · ${row.make}` : ""}
              {row.model ? ` ${row.model}` : ""}
              {row.year ? ` (${row.year})` : ""}
            </p>
          </div>
        ),
      },
      { key: "status", header: "Status", minWidth: 104, cell: (row) => <VehicleStatusBadge status={row.status} /> },
      {
        key: "capacity",
        header: "Tank capacity",
        minWidth: 112,
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (row.tankCapacity == null ? "-" : `${formatNumber(Math.round(row.tankCapacity))} L`),
      },
      {
        key: "odometer",
        header: "Odometer",
        minWidth: 104,
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (row.odometerKm == null ? "-" : `${formatNumber(Math.round(row.odometerKm))} km`),
      },
      {
        key: "tracker",
        header: "GPS tracker",
        minWidth: 120,
        cell: (row) =>
          row.tracker ? (
            <div>
              <p className="text-[0.8125rem] text-[var(--ink)]">{row.tracker.serialNumber}</p>
              <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{row.tracker.status}</p>
            </div>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">Not paired</span>
          ),
      },
      {
        key: "driver",
        header: "Driver",
        minWidth: 140,
        hideOnMobile: true,
        cell: (row) =>
          row.driverName ? (
            <div>
              <p className="text-[0.8125rem] text-[var(--ink)]">{row.driverName}</p>
              {row.driverPhone ? <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{row.driverPhone}</p> : null}
            </div>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">Unassigned</span>
          ),
      },
      // Only offered when the user can act on a vehicle, so the heading never sits over an empty column.
      ...(canEdit || canViewDevices || canArchive
        ? [
            actionsColumn<VehicleRow>(
              (row) => (
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {canEdit ? (
                    <Link href={`/vehicles/${row.id}/edit`} className="btn btn-ghost btn-sm">
                      Edit
                    </Link>
                  ) : null}
                  {canViewDevices ? (
                    <>
                      <Link href={`/vehicles/${row.id}`} className="btn btn-ghost btn-sm">
                        Position history
                      </Link>
                      <Link href="/devices?type=gps_tracker" className="btn btn-ghost btn-sm">
                        Tracker
                      </Link>
                    </>
                  ) : null}
                  {canArchive ? (
                    <Button size="sm" variant="ghost" onClick={() => setArchiveId(row.id)}>
                      {row.isArchived ? "Restore" : "Archive"}
                    </Button>
                  ) : null}
                </div>
              ),
              { minWidth: 216 },
            ),
          ]
        : []),
    ],
    [canArchive, canEdit, canViewDevices],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter active or archived vehicles"
          className="w-44"
          value={query.filters.archived ?? ""}
          onChange={(event) => query.setFilter("archived", event.target.value)}
          options={[
            { value: "", label: "Active vehicles" },
            { value: "true", label: "Archived vehicles" },
          ]}
        />
        <Select
          aria-label="Filter by status"
          className="w-40"
          value={query.filters.status ?? ""}
          onChange={(event) => query.setFilter("status", event.target.value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "maintenance", label: "In maintenance" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="vehicles"
          disabled={query.loading}
          columns={[
            { header: "Vehicle", value: (row) => row.name },
            { header: "Plate number", value: (row) => row.plateNumber },
            { header: "Type", value: (row) => row.type },
            { header: "Make", value: (row) => row.make ?? "" },
            { header: "Model", value: (row) => row.model ?? "" },
            { header: "Year", value: (row) => row.year ?? "" },
            { header: "Tank capacity (L)", value: (row) => row.tankCapacity ?? "" },
            { header: "Odometer (km)", value: (row) => row.odometerKm ?? "" },
            { header: "Status", value: (row) => row.status },
            { header: "Driver", value: (row) => row.driverName ?? "" },
            { header: "Driver phone", value: (row) => row.driverPhone ?? "" },
            { header: "GPS tracker", value: (row) => row.tracker?.serialNumber ?? "" },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="vehicle"
          title="No vehicles have been added yet"
          description="Vehicles move fuel between your sites. Add a vehicle and pair a GPS tracker to reconcile deliveries."
          action={canCreate ? (
            <Link href="/vehicles/new" className="btn btn-primary btn-sm">
              Add vehicle
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
          searchPlaceholder="Search vehicles by name, plate or driver…"
          emptyTitle="No vehicles have been added yet"
          emptyDescription="Add a vehicle to start tracking fuel movements."
          emptyAction={canCreate ? (
            <Link href="/vehicles/new" className="btn btn-primary btn-sm">
              Add vehicle
            </Link>
          ) : undefined}
        />
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setArchiveId(null)}
        onConfirm={updateArchiveState}
        title={target?.isArchived ? "Restore this vehicle?" : "Archive this vehicle?"}
        message={target?.isArchived
          ? `${target.plateNumber} will return to active views. Its movement history remains intact.`
          : `${target?.plateNumber ?? "This vehicle"} will be hidden from active views. Its movement history is preserved.`}
        confirmLabel={target?.isArchived ? "Restore vehicle" : "Archive vehicle"}
        loading={busy}
      />
    </div>
  );
}
