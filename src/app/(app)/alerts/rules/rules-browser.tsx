"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, Switch } from "@/components/ui/form";
import { DataTable, actionsColumn, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { AlertSeverityBadge } from "@/components/domain/badges";
import { LoadError, useResourceQuery } from "@/components/domain/resource-query";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/feedback";
import Link from "next/link";

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  scope: "tank" | "station" | "device" | "vehicle" | "organization";
  tankId: string | null;
  stationId: string | null;
  severity: "critical" | "warning" | "info";
  channels: string[];
  isEnabled: boolean;
  cooldownMin: number;
  condition: Record<string, unknown>;
  tankName: string | null;
  stationName: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  critical_fuel: "Critical fuel level",
  low_fuel: "Low fuel level",
  invalid_reading: "Invalid telemetry reading",
  temperature_abnormal: "Temperature abnormality",
  high_fuel: "High fuel level",
  overfill: "Overfill risk",
  water_detected: "Water detected",
  high_temperature: "High temperature",
  probe_offline: "Probe offline",
  gps_offline: "GPS device offline",
  refill: "Refill detected",
  unexpected_refuel: "Unexpected refuel",
  suspected_loss: "Suspected loss",
  reconciliation_variance: "Reconciliation variance",
  device_offline: "Device offline",
  rapid_change: "Rapid level change",
};

export function RulesBrowser({ initialRows, canManage }: { initialRows: RuleRow[]; canManage: boolean }) {
  const query = useResourceQuery<RuleRow>({
    endpoint: "/api/alert-rules",
    initial: { rows: initialRows, total: initialRows.length, page: 1, pageSize: 25 },
    pageSize: 25,
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = query.rows as RuleRow[];
  const target = rows.find((row) => row.id === deleteId) ?? null;

  const toggle = async (rule: RuleRow, isEnabled: boolean) => {
    try {
      const response = await fetch(`/api/alert-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isEnabled }),
      });
      const payload = await response.json();
      if (payload.ok) {
        toast.success(isEnabled ? "Rule enabled" : "Rule disabled", rule.name);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not update the rule.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    }
  };

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/alert-rules/${target.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (payload.ok) {
        toast.success("Rule disabled", target.name);
        setDeleteId(null);
        query.refresh();
      } else {
        toast.error(payload.error?.message ?? "Could not disable the rule.");
      }
    } catch {
      toast.error("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<RuleRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Rule",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{row.name}</p>
            <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
              {TYPE_LABELS[row.type] ?? row.type}
              {row.description ? ` · ${row.description}` : ""}
            </p>
          </div>
        ),
      },
      {
        key: "scope",
        header: "Scope",
        cell: (row) => (
          <div>
            <span className="badge badge-neutral">
              {row.scope === "tank" ? "Tank" : row.scope === "station" ? "Station" : row.scope === "device" ? "Device" : row.scope === "vehicle" ? "Vehicle" : "Organization"}
            </span>
            {row.tankName || row.stationName ? (
              <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)]">{row.tankName ?? row.stationName}</p>
            ) : null}
          </div>
        ),
      },
      { key: "severity", header: "Severity", cell: (row) => <AlertSeverityBadge severity={row.severity} /> },
      {
        key: "condition",
        header: "Condition",
        hideOnMobile: true,
        cell: (row) => (
          <code className="text-num rounded-md bg-[var(--surface-3)] px-2 py-1 text-[0.6875rem] text-[var(--ink-2)]">
            {JSON.stringify(row.condition)}
          </code>
        ),
      },
      {
        key: "cooldown",
        header: "Cooldown",
        numeric: true,
        hideOnMobile: true,
        cell: (row) => `${row.cooldownMin} min`,
      },
      {
        key: "channels",
        header: "Channels",
        hideOnMobile: true,
        cell: (row) => <span className="text-[0.75rem] text-[var(--ink-2)]">{row.channels.join(", ") || "in_app"}</span>,
      },
      {
        key: "isEnabled",
        header: "Enabled",
        cell: (row) => (
          <span className="flex justify-center">
            <Switch
              checked={row.isEnabled}
              onChange={(value) => toggle(row, value)}
              disabled={!canManage}
              label=""
              size="sm"
              id={`rule-enabled-${row.id}`}
            />
          </span>
        ),
      },
      // Only offered to users who can manage rules, so the heading never sits over an empty column.
      ...(canManage
        ? [
            actionsColumn<RuleRow>((row) => (
              <div className="flex items-center justify-end">
                <Button size="sm" variant="ghost" onClick={() => setDeleteId(row.id)} disabled={!row.isEnabled}>
                  Disable
                </Button>
              </div>
            )),
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage],
  );

  return (
    <div className="space-y-4">
      {query.error ? <LoadError message={query.error} onRetry={query.refresh} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by scope"
          className="w-44"
          value={query.filters.scope ?? ""}
          onChange={(event) => query.setFilter("scope", event.target.value)}
          options={[
            { value: "", label: "All scopes" },
            { value: "tank", label: "Tank" },
            { value: "station", label: "Station" },
            { value: "device", label: "Device" },
            { value: "organization", label: "Organization" },
          ]}
        />
        <div className="flex-1" />
        {canManage ? (
          <Link href="/alerts/rules/new" className="btn btn-primary btn-sm">
            Create rule
          </Link>
        ) : null}
      </div>

      {rows.length === 0 && !query.loading ? (
        <EmptyState
          icon="sliders"
          title="No alert rules configured"
          description="Rules decide when the platform raises an alert. Create your first rule to start being notified about threshold breaches."
          action={canManage ? (
            <Link href="/alerts/rules/new" className="btn btn-primary btn-sm">
              Create rule
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
          onSearch={query.setSearch}
          searchValue={query.search}
          searchPlaceholder="Search rules by name or type…"
          emptyTitle="No alert rules configured"
          emptyDescription="Create a rule to start receiving alerts."
        />
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title="Disable this rule?"
        message={`${target?.name ?? "This rule"} will stop raising new alerts. Existing alerts and rule history will be preserved.`}
        confirmLabel="Disable rule"
        loading={busy}
      />
    </div>
  );
}
