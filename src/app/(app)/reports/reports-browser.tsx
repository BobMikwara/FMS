"use client";

import { useMemo, useState } from "react";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/feedback";
import { LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";
import Link from "next/link";

interface ReportRow {
  id: string;
  title: string;
  category: string;
  period: string;
  dateFrom: string;
  dateTo: string;
  status: "queued" | "generating" | "ready" | "failed" | "archived";
  format: string;
  fileUrl: string | null;
  createdAt: string;
  authorName: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  consumption: "Consumption",
  inventory: "Inventory",
  reconciliation: "Reconciliation",
  refills: "Refills",
  alerts: "Alerts",
  vehicles: "Vehicles",
  audit: "Audit",
  summary: "Summary",
};

const STATUS_TONE: Record<string, "ok" | "warn" | "crit" | "neutral"> = {
  ready: "ok",
  generating: "warn",
  queued: "neutral",
  failed: "crit",
  archived: "neutral",
};

export function ReportsBrowser({
  initialRows,
  canCreate,
  canExport,
}: {
  initialRows: ReportRow[];
  canCreate: boolean;
  canExport: boolean;
}) {
  const query = useResourceQuery<ReportRow>({
    endpoint: "/api/reports",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 20 },
    pageSize: 20,
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = query.rows as ReportRow[];
  const target = rows.find((row) => row.id === deleteId) ?? null;

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const restoring = target.status === "archived";
      const response = await fetch(`/api/reports/${target.id}`, {
        method: restoring ? "PATCH" : "DELETE",
        ...(restoring ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "ready" }),
        } : {}),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(restoring ? "Report restored" : "Report archived", target.title);
        setDeleteId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? (restoring ? "Could not restore the report." : "Could not archive the report."));
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ReportRow>[] = useMemo(
    () => [
      {
        key: "title",
        header: "Report",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{row.title}</p>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {CATEGORY_LABELS[row.category] ?? row.category} · {row.period} · {row.format.toUpperCase()}
            </p>
          </div>
        ),
      },
      {
        key: "period",
        header: "Period covered",
        hideOnMobile: true,
        cell: (row) => (
          <span className="text-num text-[0.75rem] text-[var(--ink-2)]">
            {formatDateTime(row.dateFrom)} → {formatDateTime(row.dateTo)}
          </span>
        ),
      },
      { key: "status", header: "Status", cell: (row) => <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge> },
      {
        key: "createdAt",
        header: "Generated",
        hideOnMobile: true,
        cell: (row) => (
          <div>
            <p className="text-num text-[0.75rem] text-[var(--ink-2)]">{timeAgo(row.createdAt)}</p>
            <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">by {row.authorName}</p>
          </div>
        ),
      },
      {
        key: "file",
        header: "File",
        hideOnMobile: true,
        cell: (row) =>
          canExport && row.fileUrl ? (
            <a className="link text-[0.75rem]" href={row.fileUrl} download>
              Download {row.format.toUpperCase()}
            </a>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">No file</span>
          ),
      },
      {
        key: "actions",
        header: "",
        cell: (row) => canCreate ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDeleteId(row.id)}>
              {row.status === "archived" ? "Restore" : "Archive"}
            </Button>
          </div>
        ) : null,
      },
    ],
    [canCreate, canExport],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Report lifecycle"
          className="w-44"
          value={query.filters.archived ?? ""}
          onChange={(event) => query.setFilter("archived", event.target.value)}
          options={[
            { value: "", label: "Current reports" },
            { value: "true", label: "Archived reports" },
          ]}
        />
        <Select
          aria-label="Filter by category"
          className="w-44"
          value={query.filters.category ?? ""}
          onChange={(event) => query.setFilter("category", event.target.value)}
          options={[
            { value: "", label: "All categories" },
            ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <div className="flex-1" />
        {canCreate ? (
          <Link href="/reports/new" className="btn btn-primary btn-sm">
            Generate report
          </Link>
        ) : null}
      </div>

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
        searchPlaceholder="Search reports by title or author…"
        emptyTitle="No reports have been generated yet"
        emptyDescription="Generate your first report to summarise a period of fuel activity."
        emptyAction={canCreate ? (
          <Link href="/reports/new" className="btn btn-primary btn-sm">
            Generate report
          </Link>
        ) : undefined}
      />

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title={target?.status === "archived" ? "Restore this report?" : "Archive this report?"}
        message={target?.status === "archived" ? `${target.title} will return to the current reports list.` : `${target?.title ?? "This report"} will be hidden from the current list. The report record and file reference will be retained.`}
        confirmLabel={target?.status === "archived" ? "Restore report" : "Archive report"}
        loading={busy}
      />
    </div>
  );
}
