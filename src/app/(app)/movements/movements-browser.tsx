"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNumber, timeAgo } from "@/lib/utils";
import { formatDateTimeInTimeZone, dayStartInTimeZone } from "@/server/services/time-zone";
import { Select } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { EventTypeBadge, ConfidenceBadge } from "@/components/domain/badges";
import { ExportButton, LoadError, useResourceQuery } from "@/components/domain/resource-query";

interface MovementRow {
  id: string;
  ts: string;
  type: string;
  volume: number;
  levelBefore: number;
  levelAfter: number;
  confidence: "high" | "medium" | "low";
  status: string;
  reason: string | null;
  tankId: string;
  stationId: string;
  deviceId: string | null;
  timeZone: string;
  tankName?: string;
  stationName?: string;
}

const TYPE_OPTIONS = [
  { value: "", label: "All movements" },
  { value: "refill", label: "Refills" },
  { value: "consumption", label: "Tank outflow" },
  { value: "anomaly", label: "Possible anomalies" },
  { value: "delivery", label: "Deliveries" },
];

export function MovementsBrowser({
  initialRows,
  from,
  to,
  organizationTimeZone,
}: {
  initialRows: MovementRow[];
  from: string;
  to: string;
  organizationTimeZone: string;
}) {
  const query = useResourceQuery<MovementRow>({
    endpoint: "/api/movements",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 30 },
    pageSize: 30,
  });
  const [range, setRange] = useState("14");
  const rows = query.rows as MovementRow[];

  const columns: Column<MovementRow>[] = useMemo(
    () => [
      {
        key: "ts",
        header: "Timestamp (station local)",
        cell: (row) => (
          <div>
            <p className="text-num text-[0.8125rem] text-[var(--ink)]">{formatDateTimeInTimeZone(row.ts, row.timeZone)}</p>
            <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{timeAgo(row.ts)} · {row.timeZone}</p>
          </div>
        ),
      },
      { key: "type", header: "Movement", cell: (row) => <EventTypeBadge type={row.type} /> },
      {
        key: "tank",
        header: "Tank",
        cell: (row) =>
          row.tankName ? (
            <Link href={`/tanks/${row.tankId}`} className="text-[0.8125rem] text-[var(--brand-ink)] hover:underline">
              {row.tankName}
            </Link>
          ) : (
            <Link href={`/tanks/${row.tankId}`} className="text-[0.8125rem] text-[var(--brand-ink)] hover:underline">
              View tank
            </Link>
          ),
      },
      {
        key: "station",
        header: "Station",
        hideOnMobile: true,
        cell: (row) =>
          row.stationName ? (
            <Link href={`/stations/${row.stationId}`} className="text-[0.8125rem] text-[var(--ink)] hover:underline">
              {row.stationName}
            </Link>
          ) : (
            <Link href={`/stations/${row.stationId}`} className="text-[0.8125rem] text-[var(--ink)] hover:underline">
              View station
            </Link>
          ),
      },
      {
        key: "volume",
        header: "Volume",
        numeric: true,
        cell: (row) => (
          <span
            className={
              row.type === "refill" ? "text-num font-semibold text-[var(--ok)]" : "text-num font-semibold text-[var(--ink)]"
            }
          >
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
      {
        key: "confidence",
        header: "Confidence",
        hideOnMobile: true,
        cell: (row) => <ConfidenceBadge value={row.confidence} />,
      },
      {
        key: "status",
        header: "Status",
        hideOnMobile: true,
        cell: (row) => (
          <span className="badge badge-neutral">
            {row.status === "confirmed" ? "Confirmed" : row.status === "suspected" ? "Suspected" : "Rejected"}
          </span>
        ),
      },
    ],
    [],
  );

  const applyRange = (days: string) => {
    setRange(days);
    if (days === "custom") return;
    query.setFilter("from", isoDaysAgo(Number(days), organizationTimeZone));
  };

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Movement type"
          className="w-44"
          value={query.filters.type ?? ""}
          onChange={(event) => query.setFilter("type", event.target.value)}
          options={TYPE_OPTIONS}
        />
        <Select aria-label="Date range" className="w-40" value={range} onChange={(event) => applyRange(event.target.value)} options={[
          { value: "1", label: "Last 24 hours" },
          { value: "7", label: "Last 7 days" },
          { value: "14", label: "Last 14 days" },
          { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" },
        ]} />
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="fuel-movement-ledger"
          disabled={query.loading}
          columns={[
            { header: "Timestamp (station local time)", value: (row) => `${formatDateTimeInTimeZone(row.ts, row.timeZone)} (${row.timeZone})` },
            { header: "Movement", value: (row) => row.type },
            { header: "Tank", value: (row) => row.tankName ?? row.tankId },
            { header: "Station", value: (row) => row.stationName ?? row.stationId },
            { header: "Volume (L)", value: (row) => row.volume },
            { header: "Level before (L)", value: (row) => row.levelBefore },
            { header: "Level after (L)", value: (row) => row.levelAfter },
            { header: "Confidence", value: (row) => row.confidence },
            { header: "Status", value: (row) => row.status },
            { header: "Reason", value: (row) => row.reason ?? "" },
          ]}
        />
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="movement"
          title="No movements recorded yet"
          description="Refills and tank outflow are detected automatically once a tank reports a sustained level change. Nothing has been detected in this period."
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
          onSearch={query.setSearch}
          searchValue={query.search}
          searchPlaceholder="Search by tank or station…"
          emptyTitle="No movements recorded yet"
          emptyDescription="Refills and consumption appear here automatically."
        />
      )}
    </div>
  );
}

function isoDaysAgo(days: number, timeZone: string): string {
  const now = new Date();
  if (days <= 1) return new Date(now.getTime() - 86_400_000).toISOString();
  return dayStartInTimeZone(now, -(days - 1), timeZone).toISOString();
}
