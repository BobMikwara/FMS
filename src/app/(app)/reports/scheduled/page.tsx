import { hasOrganizationWideStationAccess, stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Mail } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listScheduledReports } from "@/server/db/repo/reports";
import { deliveryStatusCountsForRuns, latestScheduledReportRuns } from "@/server/db/repo/scheduled-runs";
import { emailDeliveryConfigured } from "@/server/email/mailer";
import { listAllStations } from "@/server/db/repo/stations";
import { PageHeader, Notice } from "@/components/ui/layout";
import { ScheduledReportsBrowser } from "./scheduled-reports-browser";
import { REPORT_CATEGORIES } from "@/lib/report-categories";

export const dynamic = "force-dynamic";

export default async function ScheduledReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scheduled = await listScheduledReports(user.organizationId, stationScopeForUser(user));
  const stations = (await listAllStations(user.organizationId)).filter((station) => userCanAccessStation(user, station.id));
  const latestRuns = await latestScheduledReportRuns(scheduled.map((entry) => entry.id));
  const deliveryCounts = await deliveryStatusCountsForRuns([...latestRuns.values()].map((run) => run.id));
  const canManage = hasPermission(user, "reports.schedule");
  const rows = scheduled.map((entry) => {
    const run = latestRuns.get(entry.id) ?? null;
    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      period: entry.period,
      dayOfWeek: entry.dayOfWeek,
      dayOfMonth: entry.dayOfMonth,
      timeOfDay: entry.timeOfDay,
      timezone: entry.timezone,
      recipients: canManage ? entry.recipients : [],
      format: entry.format,
      stationId: entry.stationId,
      isEnabled: entry.isEnabled,
      lastRunAt: entry.lastRunAt,
      nextRunAt: entry.nextRunAt,
      lastRunStatus: run?.status ?? null,
      lastRunError: run?.lastError ?? null,
      lastRunDeliveries: run ? deliveryCounts.get(run.id) ?? {} : {},
    };
  });
  const stationName = new Map(stations.map((station) => [station.id, station.name]));
  const mailConfigured = emailDeliveryConfigured();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scheduled reports"
        description="Reports run on the saved cadence, create a durable report record, and queue an email attachment for each configured recipient."
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Scheduled" }]}
        actions={
          <Link href="/reports" className="btn btn-secondary btn-sm">
            Back to reports
          </Link>
        }
      />

      {mailConfigured ? (
        <Notice tone="ok" title="Scheduled execution is active">
          Due schedules are picked up by the maintenance sweep, which runs at least once a day and again whenever the
          platform is in use. Report generation and each recipient delivery have separate status records; transient email
          failures are retried automatically.
        </Notice>
      ) : (
        <Notice tone="info" title="Report generation is active; email is not configured">
          Scheduled reports will be generated, but email deliveries remain queued without consuming attempts until SMTP
          settings are provided. In-app notification delivery does not depend on SMTP.
        </Notice>
      )}

      <ScheduledReportsBrowser
        initialRows={rows}
        stationOptions={stations.map((station) => ({ id: station.id, name: station.name }))}
        allowAllStations={hasOrganizationWideStationAccess(user)}
        operational
        canManage={canManage}
      />

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">
          <CalendarClock size={15} className="text-[var(--ink-3)]" />
          Schedule and delivery behavior
        </h2>
        <ul className="mt-3 space-y-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          <li>Daily schedules report the previous local calendar day.</li>
          <li>Weekly schedules report the previous seven local calendar days.</li>
          <li>Monthly schedules report the previous local calendar month.</li>
          <li>Station schedules use that station's IANA time zone; network schedules use the organization time zone.</li>
          <li>PDF format is sent as print-ready HTML because no PDF rendering service is configured.</li>
        </ul>
        <p className="mt-3 flex items-center gap-2 text-[0.75rem] text-[var(--ink-3)]">
          <Mail size={13} />
          Email delivery is tracked per recipient. Failed deliveries remain visible with the last error and retry outcome.
        </p>
      </section>

      {rows.length > 0 ? (
        <p className="text-[0.6875rem] text-[var(--ink-3)]">
          {rows.length} saved schedule definitions. Station scope:{" "}
          {Array.from(new Set(rows.map((row) => (row.stationId ? stationName.get(row.stationId) ?? "unknown" : "All stations")))).join(", ")}.
        </p>
      ) : null}

      <p className="text-[0.6875rem] text-[var(--ink-3)]">
        Available categories: {REPORT_CATEGORIES.map((entry) => entry.label).join(", ")}.
      </p>
    </div>
  );
}
