"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNumber, formatPercent } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DataTable, actionsColumn, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { StationStatusBadge } from "@/components/domain/badges";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";

interface StationRow {
  id: string;
  name: string;
  code: string;
  city: string;
  region: string;
  country: string;
  address: string;
  status: "online" | "warning" | "critical" | "offline";
  isArchived: boolean;
  latitude: number;
  longitude: number;
  openingTime: string;
  closingTime: string;
  tankCount: number | null;
  totalFuel: number | null;
  capacity: number | null;
  utilizationPct: number | null;
  todayConsumption: number | null;
  todayRefills: number | null;
  activeAlerts: number | null;
  offlineDevices: number | null;
  totalDevices: number | null;
  createdAt: string;
}

export function StationsBrowser({
  initialRows,
  canCreate,
  canArchive,
  canViewTanks,
  canViewMovements,
  canViewAlerts,
  canViewDevices,
}: {
  initialRows: StationRow[];
  canCreate: boolean;
  canArchive: boolean;
  canViewTanks: boolean;
  canViewMovements: boolean;
  canViewAlerts: boolean;
  canViewDevices: boolean;
}) {
  const query = useResourceQuery<StationRow>({
    endpoint: "/api/stations",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 25 },
    pageSize: 25,
  });
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = query.rows as StationRow[];
  const target = rows.find((row) => row.id === archiveId) ?? null;

  const updateArchiveState = async () => {
    if (!target) return;
    const restoring = target.isArchived;
    setBusy(true);
    try {
      const response = await fetch(`/api/stations/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isArchived: !restoring }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(restoring ? "Station restored" : "Station archived", target.name);
        setArchiveId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? (restoring ? "Could not restore the station." : "Could not archive the station."));
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<StationRow>[] = useMemo(() => {
    const result: Column<StationRow>[] = [
      {
        key: "name",
        header: "Station",
        minWidth: 184,
        cell: (row) => (
          <div className="min-w-0">
            <Link href={`/stations/${row.id}`} className="block truncate text-[0.8125rem] font-medium text-[var(--ink)] hover:underline">
              {row.name}
            </Link>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {row.code} · {row.city}, {row.region}
            </p>
          </div>
        ),
      },
      { key: "status", header: "Status", minWidth: 96, cell: (row) => <StationStatusBadge status={row.status} /> },
    ];

    if (canViewTanks) {
      result.push(
        {
          key: "tanks",
          header: "Tanks",
          minWidth: 68,
          numeric: true,
          hideOnMobile: true,
          cell: (row) => row.tankCount ?? "-",
        },
        {
          key: "fuel",
          header: "Fuel on hand",
          minWidth: 116,
          numeric: true,
          cell: (row) => row.totalFuel == null || row.capacity == null ? "-" : (
            <div>
              <p className="text-num font-semibold text-[var(--ink)]">{formatNumber(row.totalFuel)} L</p>
              <p className="text-[0.6875rem] text-[var(--ink-3)] text-num">
                {formatPercent(row.capacity > 0 ? (row.totalFuel / row.capacity) * 100 : 0, 0)} of {formatNumber(row.capacity)} L
              </p>
            </div>
          ),
        },
      );
    }

    if (canViewMovements) {
      result.push(
        {
          key: "consumption",
          header: "Outflow today",
          minWidth: 92,
          numeric: true,
          hideOnMobile: true,
          cell: (row) => row.todayConsumption == null ? "-" : <span className="text-num">{formatNumber(row.todayConsumption)} L</span>,
        },
        {
          key: "refills",
          header: "Refills today",
          minWidth: 84,
          numeric: true,
          hideOnMobile: true,
          cell: (row) => row.todayRefills == null ? "-" : <span className="text-num">{formatNumber(row.todayRefills)} L</span>,
        },
      );
    }

    if (canViewAlerts) {
      result.push({
        key: "alerts",
        header: "Alerts",
        minWidth: 92,
        numeric: true,
        cell: (row) => row.activeAlerts != null && row.activeAlerts > 0 ? (
          <span className="badge badge-crit">{row.activeAlerts} active</span>
        ) : row.activeAlerts === 0 ? (
          <span className="text-[0.75rem] text-[var(--ink-3)]">None</span>
        ) : "-",
      });
    }

    if (canViewDevices) {
      result.push({
        key: "devices",
        header: "Devices",
        minWidth: 80,
        numeric: true,
        hideOnMobile: true,
        cell: (row) => row.totalDevices == null || row.offlineDevices == null ? "-" : (
          <span className="whitespace-nowrap text-num text-[0.8125rem]">
            {row.totalDevices - row.offlineDevices}/{row.totalDevices}
          </span>
        ),
      });
    }

    result.push(
      actionsColumn<StationRow>(
        (row) => (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href={`/stations/${row.id}`} className="btn btn-ghost btn-sm">
              View
            </Link>
            {canArchive ? (
              <Button size="sm" variant="ghost" onClick={() => setArchiveId(row.id)}>
                {row.isArchived ? "Restore" : "Archive"}
              </Button>
            ) : null}
          </div>
        ),
        { minWidth: 116 },
      ),
    );

    return result;
  }, [canArchive, canViewAlerts, canViewDevices, canViewMovements, canViewTanks]);

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter active or archived stations"
          className="w-44"
          value={query.filters.archived ?? ""}
          onChange={(event) => query.setFilter("archived", event.target.value)}
          options={[
            { value: "", label: "Active stations" },
            { value: "true", label: "Archived stations" },
          ]}
        />
        <Select
          aria-label="Filter by status"
          className="w-40"
          value={query.filters.status ?? ""}
          onChange={(event) => query.setFilter("status", event.target.value)}
          options={[
            { value: "", label: "All statuses" },
            { value: "online", label: "Online" },
            { value: "warning", label: "Warning" },
            { value: "critical", label: "Critical" },
            { value: "offline", label: "Offline" },
          ]}
        />
        <Select
          aria-label="Filter by region"
          className="w-44"
          value={query.filters.region ?? ""}
          onChange={(event) => query.setFilter("region", event.target.value)}
          options={[
            { value: "", label: "All regions" },
            ...[...new Set(rows.map((row) => row.region))].sort().map((region) => ({ value: region, label: region })),
          ]}
        />
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="stations"
          disabled={query.loading}
          columns={[
            { header: "Station", value: (row) => row.name },
            { header: "Code", value: (row) => row.code },
            { header: "City", value: (row) => row.city },
            { header: "Region", value: (row) => row.region },
            { header: "Status", value: (row) => row.status },
            ...(canViewTanks ? [
              { header: "Tanks", value: (row: StationRow) => row.tankCount ?? "-" },
              { header: "Fuel on hand (L)", value: (row: StationRow) => row.totalFuel ?? "-" },
              { header: "Capacity (L)", value: (row: StationRow) => row.capacity ?? "-" },
              { header: "Utilization (%)", value: (row: StationRow) => row.utilizationPct ?? "-" },
            ] : []),
            ...(canViewMovements ? [
              { header: "Outflow today (L)", value: (row: StationRow) => row.todayConsumption ?? "-" },
              { header: "Refills today (L)", value: (row: StationRow) => row.todayRefills ?? "-" },
            ] : []),
            ...(canViewAlerts ? [{ header: "Active alerts", value: (row: StationRow) => row.activeAlerts ?? "-" }] : []),
            ...(canViewDevices ? [{
              header: "Devices",
              value: (row: StationRow) => row.totalDevices == null || row.offlineDevices == null ? "-" : `${row.totalDevices - row.offlineDevices}/${row.totalDevices}`,
            }] : []),
            { header: "Latitude", value: (row) => row.latitude },
            { header: "Longitude", value: (row) => row.longitude },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="station"
          title="No stations match your filters"
          description="Try a different search term or clear the filters. You can also add a new station at any time."
          action={
            canCreate ? (
              <Link href="/stations/new" className="btn btn-primary btn-sm">
                Add station
              </Link>
            ) : undefined
          }
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
          searchPlaceholder="Search stations by name, code or city…"
          emptyTitle="No stations have been added yet"
          emptyDescription="Stations group your tanks, devices and users. Add your first station to begin monitoring."
          emptyAction={canCreate ? (
            <Link href="/stations/new" className="btn btn-primary btn-sm">
              Add station
            </Link>
          ) : undefined}
        />
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setArchiveId(null)}
        onConfirm={updateArchiveState}
        title={target?.isArchived ? "Restore this station?" : "Archive this station?"}
        message={target?.isArchived
          ? `${target.name} will return to active views. Historical tanks, readings and alerts remain intact.`
          : `${target?.name ?? "This station"} will be hidden from active views. Its tanks, readings and alerts are preserved and can be restored later.`}
        confirmLabel={target?.isArchived ? "Restore station" : "Archive station"}
        loading={busy}
      />
    </div>
  );
}
