import { stationScopeForUser, userCanAccessStationScopedUser } from "@/server/auth/authorization";
import Link from "next/link";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listReports, listScheduledReports } from "@/server/db/repo/reports";
import { listUsers } from "@/server/db/repo/core";
import { PageHeader } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { ReportsBrowser } from "./reports-browser";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  consumption: "Consumption",
  inventory: "Inventory",
  reconciliation: "Reconciliation",
  refills: "Refills",
  alerts: "Alerts",
  vehicles: "Vehicles",
  audit: "Audit",
  summary: "Executive summary",
};

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const reports = (await listReports({ orgId: user.organizationId, pageSize: 50, stationIds: stationScopeForUser(user) })).rows;
  const scheduled = (await listScheduledReports(user.organizationId, stationScopeForUser(user)));
  const users = (await listUsers(user.organizationId, stationScopeForUser(user)))
    .filter((entry) => userCanAccessStationScopedUser(user, entry.stationIds, entry.roleKey));
  const authorName = new Map(users.map((entry) => [entry.id, entry.name]));

  const rows = reports.map((report) => ({
    id: report.id,
    title: report.title,
    category: report.category,
    period: report.period,
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    status: report.status,
    format: report.format,
    fileUrl: hasPermission(user, "reports.export") ? report.fileUrl : null,
    createdAt: report.createdAt,
    authorName: authorName.get(report.createdById) ?? "Unknown",
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Generate daily, weekly, monthly or custom reports and export them as PDF, Excel or CSV. Scheduled reports are delivered automatically."
        actions={hasPermission(user, "reports.schedule") || hasPermission(user, "reports.create") ? (
          <div className="flex items-center gap-2">
            {hasPermission(user, "reports.schedule") ? (
              <Link href="/reports/scheduled" className="btn btn-secondary btn-sm">
                Scheduled
              </Link>
            ) : null}
            {hasPermission(user, "reports.create") ? (
              <Link href="/reports/new" className="btn btn-primary btn-sm">
                Generate report
              </Link>
            ) : null}
          </div>
        ) : undefined}
      />

      {scheduled.length > 0 ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Scheduled reports</h2>
              <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
                {scheduled.filter((entry) => entry.isEnabled).length} of {scheduled.length} active.
              </p>
            </div>
            {hasPermission(user, "reports.schedule") ? (
              <Link href="/reports/scheduled" className="btn btn-ghost btn-sm">
                Manage
              </Link>
            ) : null}
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scheduled.slice(0, 3).map((entry) => (
              <li key={entry.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[0.8125rem] font-medium text-[var(--ink)]">{entry.name}</p>
                  <Badge tone={entry.isEnabled ? "ok" : "neutral"}>{entry.isEnabled ? "Active" : "Paused"}</Badge>
                </div>
                <p className="mt-1.5 text-[0.75rem] text-[var(--ink-3)]">
                  {CATEGORY_LABELS[entry.category] ?? entry.category} · {entry.period} · {entry.format.toUpperCase()}
                </p>
                <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">
                  {entry.nextRunAt ? `Next run ${timeAgo(entry.nextRunAt)}` : "Next run not scheduled"}
                  {entry.lastRunAt ? ` · last ${timeAgo(entry.lastRunAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReportsBrowser
        initialRows={rows}
        canCreate={hasPermission(user, "reports.create")}
        canExport={hasPermission(user, "reports.export")}
      />

      <p className="text-[0.6875rem] text-[var(--ink-3)]">
        Report timestamps are shown in UTC. {reports.length > 0 ? `Latest generated ${formatDateTime(rows[0].createdAt)}.` : ""}
      </p>
    </div>
  );
}
