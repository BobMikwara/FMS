"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { TankStatusBadge } from "@/components/domain/badges";
import { TankVisual } from "@/components/charts/tank-visual";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";

interface TankRow {
  id: string;
  name: string;
  code: string;
  stationId: string;
  stationName: string;
  fuelTypeId: string;
  capacity: number;
  currentVolume: number;
  levelPercent: number;
  status: "full" | "normal" | "low" | "critical" | "offline";
  tankType: "underground" | "above_ground";
  lowThresholdPct: number;
  criticalThresholdPct: number;
  overfillThresholdPct: number;
  lastReadingAt: string | null;
  currentTempC: number | null;
  waterLevelMm: number | null;
}

const FUEL_COLOR_FALLBACK: Record<string, string> = {
  diesel: "#1d4ed8",
  petrol: "#dc2626",
  kerosene: "#0d9488",
  gasoil: "#7c3aed",
};

export function TanksBrowser({
  initialRows,
  stations,
  fuelTypes,
}: {
  initialRows: TankRow[];
  stations: { id: string; name: string }[];
  fuelTypes: { id: string; name: string; color: string; systemName: string }[];
}) {
  const query = useResourceQuery<TankRow>({
    endpoint: "/api/tanks",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 25 },
    pageSize: 25,
  });
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = query.rows as TankRow[];
  const target = rows.find((row) => row.id === archiveId) ?? null;
  const fuelColors = useMemo(
    () => Object.fromEntries(fuelTypes.map((fuelType) => [fuelType.id, fuelType.color])),
    [fuelTypes],
  );

  const archive = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tanks/${target.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Tank archived", `${target.name} is hidden from active views.`);
        setArchiveId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not archive the tank.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<TankRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Tank",
        cell: (row) => (
          <div className="min-w-0">
            <Link href={`/tanks/${row.id}`} className="block truncate text-[0.8125rem] font-medium text-[var(--ink)] hover:underline">
              {row.name}
            </Link>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {row.code} · {row.stationName}
            </p>
          </div>
        ),
      },
      {
        key: "level",
        header: "Measured volume",
        cell: (row) => (
          <div className="flex items-center gap-3">
            <TankVisual
              name={row.name}
              fuelType={row.fuelTypeId}
              color={fuelColors[row.fuelTypeId] ?? FUEL_COLOR_FALLBACK[row.fuelTypeId] ?? "#0f766e"}
              volume={row.currentVolume}
              capacity={row.capacity}
              size="sm"
              showHeader={false}
              status={row.status}
            />
            <div className="min-w-0">
              <p className="text-num text-[0.8125rem] font-semibold text-[var(--ink)]">
                {formatNumber(Math.round(row.currentVolume))} L
              </p>
              <p className="text-[0.6875rem] text-[var(--ink-3)] text-num">
                {formatPercent(row.levelPercent, 1)} of {formatNumber(Math.round(row.capacity))} L
              </p>
            </div>
          </div>
        ),
      },
      { key: "status", header: "Status", cell: (row) => <TankStatusBadge status={row.status} /> },
      {
        key: "lastReading",
        header: "Last reading",
        hideOnMobile: true,
        cell: (row) =>
          row.lastReadingAt ? (
            <span className="text-num text-[0.75rem] text-[var(--ink-2)]">{timeAgo(row.lastReadingAt)}</span>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">Never</span>
          ),
      },
      {
        key: "temp",
        header: "Temp",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (row.currentTempC == null ? "-" : `${row.currentTempC.toFixed(1)} °C`),
      },
      {
        key: "water",
        header: "Water",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => (row.waterLevelMm == null ? "-" : `${row.waterLevelMm.toFixed(1)} mm`),
      },
      {
        key: "thresholds",
        header: "Thresholds",
        hideOnMobile: true,
        cell: (row) => (
          <span className="text-num text-[0.75rem] text-[var(--ink-2)]">
            Low {row.lowThresholdPct}% · Critical {row.criticalThresholdPct}%
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <Link href={`/tanks/${row.id}`} className="btn btn-ghost btn-sm">
              Details
            </Link>
            <Button size="sm" variant="ghost" onClick={() => setArchiveId(row.id)}>
              Archive
            </Button>
          </div>
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
            { value: "full", label: "Full" },
            { value: "normal", label: "Normal" },
            { value: "low", label: "Low" },
            { value: "critical", label: "Critical" },
            { value: "offline", label: "Offline" },
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
          filename="tanks"
          disabled={query.loading}
          columns={[
            { header: "Tank", value: (row) => row.name },
            { header: "Code", value: (row) => row.code },
            { header: "Station", value: (row) => row.stationName },
            { header: "Type", value: (row) => row.tankType },
            { header: "Status", value: (row) => row.status },
            { header: "Measured volume (L)", value: (row) => row.currentVolume },
            { header: "Capacity (L)", value: (row) => row.capacity },
            { header: "Level (%)", value: (row) => row.levelPercent },
            { header: "Temperature (C)", value: (row) => row.currentTempC ?? "" },
            { header: "Water (mm)", value: (row) => row.waterLevelMm ?? "" },
            { header: "Low threshold (%)", value: (row) => row.lowThresholdPct },
            { header: "Critical threshold (%)", value: (row) => row.criticalThresholdPct },
            { header: "Last reading", value: (row) => row.lastReadingAt ?? "" },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="tank"
          title="No tanks have been added yet"
          description="Tanks hold the probe readings that drive every metric in the platform. Add your first tank to begin monitoring."
          action={
            <Link href="/tanks/new" className="btn btn-primary btn-sm">
              Add tank
            </Link>
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
          searchPlaceholder="Search tanks by name, code or station…"
          emptyTitle="No tanks have been added yet"
          emptyDescription="Add a tank to begin collecting readings."
          emptyAction={
            <Link href="/tanks/new" className="btn btn-primary btn-sm">
              Add tank
            </Link>
          }
        />
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setArchiveId(null)}
        onConfirm={archive}
        title="Archive this tank?"
        message={`${target?.name ?? "This tank"} will be hidden from active views. Its reading history, movements and alerts are preserved.`}
        confirmLabel="Archive tank"
        loading={busy}
      />
    </div>
  );
}
