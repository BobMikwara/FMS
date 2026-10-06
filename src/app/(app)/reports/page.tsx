import { stationScopeForUser, userCanAccessStationScopedUser } from "@/server/auth/authorization";
import Link from "next/link";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listReports, listScheduledReports } from "@/server/db/repo/reports";
import { getOrganization, listUsers } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { normalizeTimeZone } from "@/server/services/time-zone";
import { PageHeader } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { timeAgo } from "@/lib/utils";
import { formatDateTimeInTimeZone } from "@/server/services/time-zone";
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

  const [reportResult, scheduled, users, stations, organization] = await Promise.all([
    listReports({ orgId: user.organizationId, pageSize: 50, stationIds: stationScopeForUser(user) }),
    listScheduledReports(user.organizationId, stationScopeForUser(user)),
    listUsers(user.organizationId, stationScopeForUser(user)),
    listAllStations(user.organizationId),
    getOrganization(user.organizationId),
  ]);
  const reports = reportResult.rows;
  const scopedUsers = users.filter((entry) => userCanAccessStationScopedUser(user, entry.stationIds, entry.roleKey));
  const authorName = new Map(scopedUsers.map((entry) => [entry.id, entry.name]));
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const organizationTimeZone = normalizeTimeZone(organization?.timezone);

  const rows = reports.map((report) => {
    const selectedStationId = report.filters.stationId;
    const storedTimeZone = report.filters.timeZone;
    const timeZone = typeof storedTimeZone === "string" && storedTimeZone.trim()
      ? normalizeTimeZone(storedTimeZone, organizationTimeZone)
      : normalizeTimeZone(
          typeof selectedStationId === "string" ? stationById.get(selectedStationId)?.timezone : undefined,
          organizationTimeZone,
        );
    return {
      id: report.id,
      title: report.title,
      category: report.category,
      period: report.period,
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
      timeZone,
      status: report.status,
      format: report.format,
      fileUrl: hasPermission(user, "reports.export") ? report.fileUrl : null,
      createdAt: report.createdAt,
      authorName: authorName.get(report.createdById) ?? "Unknown",
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Generate reports on demand and export them as PDF, Excel or CSV. Saved schedules are retained but are not executed automatically."
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
                {scheduled.length} saved. Automatic execution and delivery are unavailable.
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
                  <Badge tone="neutral">Not running</Badge>
                </div>
                <p className="mt-1.5 text-[0.75rem] text-[var(--ink-3)]">
                  {CATEGORY_LABELS[entry.category] ?? entry.category} · {entry.period} · {entry.format.toUpperCase()}
                </p>
                <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">
                  {entry.lastRunAt ? `Last recorded run ${timeAgo(entry.lastRunAt)}` : "No execution history"}
                  {entry.isEnabled ? " · configured, but not executing" : " · paused configuration"}
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
        Period dates use each report’s saved time zone. {reports.length > 0 ? `Latest generated ${formatDateTimeInTimeZone(rows[0].createdAt, organizationTimeZone)} (${organizationTimeZone}).` : ""}
      </p>
    </div>
  );
}
