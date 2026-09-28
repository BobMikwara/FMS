import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Mail } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { listScheduledReports } from "@/server/db/repo/reports";
import { listAllStations } from "@/server/db/repo/stations";
import { listUsers } from "@/server/db/repo/core";
import { PageHeader, Notice } from "@/components/ui/layout";
import { ScheduledReportsBrowser } from "./scheduled-reports-browser";
import { REPORT_CATEGORIES } from "@/lib/report-categories";

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ScheduledReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const scheduled = (await listScheduledReports(user.organizationId, user.stationIds));
  const stations = (await listAllStations(user.organizationId)).filter(
    (station) => user.stationIds.length === 0 || user.stationIds.includes(station.id),
  );
  const users = (await listUsers(user.organizationId));

  const rows = scheduled.map((entry) => ({
    id: entry.id,
    name: entry.name,
    category: entry.category,
    period: entry.period,
    dayOfWeek: entry.dayOfWeek,
    dayOfMonth: entry.dayOfMonth,
    timeOfDay: entry.timeOfDay,
    timezone: entry.timezone,
    recipients: entry.recipients,
    format: entry.format,
    stationId: entry.stationId,
    isEnabled: entry.isEnabled,
    lastRunAt: entry.lastRunAt,
    nextRunAt: entry.nextRunAt,
  }));

  const stationName = new Map(stations.map((station) => [station.id, station.name]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scheduled reports"
        description="Reports that generate and deliver themselves on a repeating schedule."
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: "Scheduled" }]}
        actions={
          <Link href="/reports" className="btn btn-secondary btn-sm">
            Back to reports
          </Link>
        }
      />

      <Notice tone="info" title="Delivery is queued, not silent">
        When a schedule fires, the report is generated and emailed to the recipients listed below, and the delivery is
        written to the audit log. If a recipient address bounces, the failure is recorded rather than swallowed.
      </Notice>

      <ScheduledReportsBrowser
        initialRows={rows}
        stationOptions={stations.map((station) => ({ id: station.id, name: station.name }))}
        recipientOptions={users.map((entry) => entry.email)}
        allowAllStations={user.stationIds.length === 0}
      />

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">
          <CalendarClock size={15} className="text-[var(--ink-3)]" />
          How schedules are worded
        </h2>
        <ul className="mt-3 space-y-1.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          <li>
            <strong className="font-medium text-[var(--ink)]">Daily</strong> - generated every day at the time you pick.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">Weekly</strong> - generated on the day of the week you pick.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">Monthly</strong> - generated on the day of the month you pick.
          </li>
        </ul>
        <p className="mt-3 flex items-center gap-2 text-[0.75rem] text-[var(--ink-3)]">
          <Mail size={13} />
          Recipients receive the file as an attachment; the link inside the app is the same dataset.
        </p>
      </section>

      {rows.length > 0 ? (
        <p className="text-[0.6875rem] text-[var(--ink-3)]">
          {rows.filter((row) => row.isEnabled).length} of {rows.length} schedules active. Station scope:{" "}
          {Array.from(new Set(rows.map((row) => (row.stationId ? stationName.get(row.stationId) ?? "unknown" : "All stations")))).join(", ")}.
        </p>
      ) : null}

      <p className="text-[0.6875rem] text-[var(--ink-3)]">
        Available categories: {REPORT_CATEGORIES.map((entry) => entry.label).join(", ")}.
      </p>
    </div>
  );
}
