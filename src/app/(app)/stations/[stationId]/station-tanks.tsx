"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatNumber, formatPercent } from "@/lib/utils";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { TankStatusBadge } from "@/components/domain/badges";
import { TankVisual } from "@/components/charts/tank-visual";
import { LoadError } from "@/components/domain/resource-query";

interface TankRow {
  id: string;
  name: string;
  code: string;
  capacity: number;
  currentVolume: number;
  status: "full" | "normal" | "low" | "critical" | "offline";
  fuelType: string;
  color: string;
  lastReadingAt: string | null;
  lowThresholdPct: number;
  criticalThresholdPct: number;
  tankType: string;
  isArchived: boolean;
}

export function StationTanks({
  stationId,
  canCreate,
  includeArchived = false,
}: {
  stationId: string;
  canCreate: boolean;
  includeArchived?: boolean;
}) {
  const [rows, setRows] = useState<TankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ stationId, pageSize: "50" });
    if (includeArchived) params.set("includeArchived", "true");
    fetch(`/api/tanks?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json();
        if (cancelled) return;
        if (!payload.ok) {
          setError(payload.error?.message ?? "Could not load the tanks at this station.");
          return;
        }
        setRows(payload.data.rows ?? []);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived, stationId]);

  const columns: Column<TankRow>[] = [
    {
      key: "name",
      header: "Tank",
      cell: (row) => (
        <div className="min-w-0">
          <Link href={`/tanks/${row.id}`} className="block truncate text-[0.8125rem] font-medium text-[var(--ink)] hover:underline">
            {row.name}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-[var(--ink-3)]">
            {row.code} · {row.fuelType}
            {row.isArchived ? <Badge tone="neutral">Archived tank</Badge> : null}
          </p>
        </div>
      ),
    },
    {
      key: "level",
      header: "Level",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <TankVisual
            name={row.name}
            fuelType={row.fuelType}
            color={row.color}
            volume={row.currentVolume}
            capacity={row.capacity}
            size="sm"
            showHeader={false}
            status={row.status}
          />
          <div>
            <p className="text-num text-[0.8125rem] font-semibold text-[var(--ink)]">
              {formatPercent(row.capacity > 0 ? (row.currentVolume / row.capacity) * 100 : 0, 1)}
            </p>
            <p className="text-[0.6875rem] text-[var(--ink-3)] text-num">
              {formatNumber(Math.round(row.currentVolume))} / {formatNumber(Math.round(row.capacity))} L
            </p>
          </div>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (row) => <TankStatusBadge status={row.status} /> },
    {
      key: "thresholds",
      header: "Thresholds",
      numeric: true,
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-num text-[0.75rem] text-[var(--ink-2)]">
          {row.lowThresholdPct}% / {row.criticalThresholdPct}%
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex justify-end">
          <Link href={`/tanks/${row.id}`} className="btn btn-ghost btn-sm">
            Details
          </Link>
        </div>
      ),
    },
  ];

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div>
          <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Tanks at this station</h2>
          <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">Measured volume, status and configured thresholds for each tank.</p>
        </div>
        {canCreate ? (
          <Link href="/tanks/new" className="btn btn-secondary btn-sm">
            Add tank
          </Link>
        ) : null}
      </div>
      {error ? (
        <div className="p-5">
          <LoadError message={error} onRetry={() => window.location.reload()} />
        </div>
      ) : rows.length === 0 && !loading ? (
        <EmptyState
          icon="tank"
          title="No tanks have been added yet"
          description="Tanks hold the probe readings that drive every metric on this page. Add the first tank to start monitoring."
          action={canCreate ? (
            <Link href="/tanks/new" className="btn btn-primary btn-sm">
              Add tank
            </Link>
          ) : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          toolbar={false}
          emptyTitle="No tanks have been added yet"
          emptyDescription="Add a tank to begin collecting readings."
        />
      )}
    </section>
  );
}
