"use client";

import { useMemo } from "react";
import { formatDateTime } from "@/lib/utils";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/feedback";
import { ExportButton, useResourceQuery } from "@/components/domain/resource-query";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  actorName: string;
  actorEmail: string;
  ipAddress: string | null;
  createdAt: string;
  metadata: string | null;
}

const ACTION_TONE: Record<string, "ok" | "warn" | "crit" | "neutral" | "info"> = {
  create: "ok",
  update: "info",
  delete: "crit",
  login: "neutral",
  logout: "neutral",
  export: "warn",
  acknowledge: "warn",
  resolve: "ok",
  error: "crit",
};

function toneFor(action: string) {
  const key = action.split(".")[0]?.toLowerCase() ?? action.toLowerCase();
  return ACTION_TONE[key] ?? "neutral";
}

export function AuditLogBrowser({ initialRows }: { initialRows: AuditRow[] }) {
  const query = useResourceQuery<AuditRow>({
    endpoint: "/api/audit-logs",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 25 },
    pageSize: 25,
  });

  const rows = query.rows as AuditRow[];

  const columns: Column<AuditRow>[] = useMemo(
    () => [
      {
        key: "createdAt",
        header: "When",
        cell: (row) => (
          <div>
            <p className="text-num text-[0.75rem] text-[var(--ink)]">{formatDateTime(row.createdAt)}</p>
            {row.ipAddress ? <p className="text-num mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{row.ipAddress}</p> : null}
          </div>
        ),
      },
      {
        key: "action",
        header: "Action",
        cell: (row) => (
          <Badge tone={toneFor(row.action)}>
            <code className="text-[0.6875rem]">{row.action}</code>
          </Badge>
        ),
      },
      {
        key: "entity",
        header: "Record",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] text-[var(--ink)]">{row.entityLabel ?? row.entityType}</p>
            <p className="mt-0.5 truncate text-[0.6875rem] text-[var(--ink-3)]">
              {row.entityType}
              {row.entityId ? ` · ${row.entityId}` : ""}
            </p>
          </div>
        ),
      },
      {
        key: "actor",
        header: "User",
        hideOnMobile: true,
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] text-[var(--ink)]">{row.actorName}</p>
            <p className="mt-0.5 truncate text-[0.6875rem] text-[var(--ink-3)]">{row.actorEmail}</p>
          </div>
        ),
      },
      {
        key: "metadata",
        header: "Detail",
        hideOnMobile: true,
        cell: (row) =>
          row.metadata ? (
            <span className="line-clamp-2 max-w-md text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{row.metadata}</span>
          ) : (
            <span className="text-[0.75rem] text-[var(--ink-3)]">-</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by action"
          className="input w-48"
          value={query.filters.action ?? ""}
          onChange={(event) => query.setFilter("action", event.target.value)}
        >
          <option value="">All actions</option>
          {Array.from(new Set(initialRows.map((row) => row.action)))
            .sort()
            .map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
        </select>
        <select
          aria-label="Filter by record type"
          className="input w-44"
          value={query.filters.entityType ?? ""}
          onChange={(event) => query.setFilter("entityType", event.target.value)}
        >
          <option value="">All record types</option>
          {Array.from(new Set(initialRows.map((row) => row.entityType)))
            .sort()
            .map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
        </select>
        <div className="flex-1" />
        <ExportButton
          rows={rows}
          filename="audit-log"
          disabled={query.loading}
          columns={[
            { header: "Timestamp", value: (row) => row.createdAt },
            { header: "Action", value: (row) => row.action },
            { header: "Record type", value: (row) => row.entityType },
            { header: "Record", value: (row) => row.entityLabel ?? row.entityId ?? "" },
            { header: "User", value: (row) => row.actorName },
            { header: "Email", value: (row) => row.actorEmail },
            { header: "IP address", value: (row) => row.ipAddress ?? "" },
            { header: "Detail", value: (row) => row.metadata ?? "" },
          ]}
        />
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
        searchPlaceholder="Search by user, record or action…"
        emptyTitle="No audit entries yet"
        emptyDescription="Activity will appear here as people use the platform."
      />
    </div>
  );
}
