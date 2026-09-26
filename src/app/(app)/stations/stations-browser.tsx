"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNumber, formatPercent } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/data-table";
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
  latitude: number;
  longitude: number;
  openingTime: string;
  closingTime: string;
  tankCount: number;
  totalFuel: number;
  capacity: number;
  utilizationPct: number;
  todayConsumption: number;
  todayRefills: number;
  activeAlerts: number;
  offlineDevices: number;
  totalDevices: number;
  createdAt: string;
}

export function StationsBrowser({ initialRows, canCreate }: { initialRows: StationRow[]; canCreate: boolean }) {
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

  const archive = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/stations/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isArchived: true, status: "offline" }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Station archived", `${target.name} is hidden from active views.`);
        setArchiveId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not archive the station.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<StationRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Station",
        width: "23%",
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
      { key: "status", header: "Status", width: "9%", cell: (row) => <StationStatusBadge status={row.status} /> },
      {
        key: "tanks",
        header: "Tanks",
        width: "7%",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => row.tankCount,
      },
      {
        key: "fuel",
        header: "Fuel on hand",
        width: "14%",
        numeric: true,
        cell: (row) => (
          <div>
            <p className="text-num font-semibold text-[var(--ink)]">{formatNumber(row.totalFuel)} L</p>
            <p className="text-[0.6875rem] text-[var(--ink-3)] text-num">
              {formatPercent(row.capacity > 0 ? (row.totalFuel / row.capacity) * 100 : 0, 0)} of {formatNumber(row.capacity)} L
            </p>
          </div>
        ),
      },
      {
        key: "consumption",
        header: "Outflow today",
        width: "11%",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => <span className="text-num">{formatNumber(row.todayConsumption)} L</span>,
      },
      {
        key: "refills",
        header: "Refills today",
        width: "11%",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => <span className="text-num">{formatNumber(row.todayRefills)} L</span>,
      },
      {
        key: "alerts",
        header: "Alerts",
        width: "8%",
        numeric: true,
        cell: (row) =>
          row.activeAlerts > 0 ? (
            <span className="badge badge-crit">{row.activeAlerts} active</span>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">None</span>
          ),
      },
      {
        key: "devices",
        header: "Devices",
        width: "7%",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (
          <span className="whitespace-nowrap text-num text-[0.8125rem]">
            {row.totalDevices - row.offlineDevices}/{row.totalDevices}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
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
            { header: "Tanks", value: (row) => row.tankCount },
            { header: "Fuel on hand (L)", value: (row) => row.totalFuel },
            { header: "Capacity (L)", value: (row) => row.capacity },
            { header: "Utilization (%)", value: (row) => row.utilizationPct },
            { header: "Outflow today (L)", value: (row) => row.todayConsumption },
            { header: "Refills today (L)", value: (row) => row.todayRefills },
            { header: "Active alerts", value: (row) => row.activeAlerts },
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
          emptyAction={
            <Link href="/stations/new" className="btn btn-primary btn-sm">
              Add station
            </Link>
          }
          rowActions={(row) => (
            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
              <Link href={`/stations/${row.id}`} className="btn btn-ghost btn-sm">
                View
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setArchiveId(row.id)}>
                Archive
              </Button>
            </div>
          )}
        />
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setArchiveId(null)}
        onConfirm={archive}
        title="Archive this station?"
        message={`${target?.name ?? "This station"} will be hidden from active views. Its tanks, readings and alerts are preserved and can be restored later.`}
        confirmLabel="Archive station"
        loading={busy}
      />
    </div>
  );
}
