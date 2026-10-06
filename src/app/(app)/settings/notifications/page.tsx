import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/feedback";
import { getCurrentUser } from "@/server/auth/session";
import { listUserNotificationDeliveries } from "@/server/db/repo/deliveries";
import { getOrganization } from "@/server/db/repo/core";
import { emailDeliveryConfigured } from "@/server/email/mailer";
import { formatDateTimeInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { PageHeader, Notice } from "@/components/ui/layout";

export const dynamic = "force-dynamic";

function statusTone(status: string): "ok" | "warn" | "crit" | "neutral" {
  if (status === "delivered") return "ok";
  if (status === "queued" || status === "sending") return "warn";
  if (status === "failed") return "crit";
  return "neutral";
}

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [deliveries, organization] = await Promise.all([
    listUserNotificationDeliveries(user.organizationId, user.id, 30),
    getOrganization(user.organizationId),
  ]);
  const timeZone = normalizeTimeZone(organization?.timezone);
  const mailConfigured = emailDeliveryConfigured();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications and delivery"
        description="In-app alerts have individual read state. Email attempts and scheduled-report deliveries are recorded per recipient."
        breadcrumbs={[{ label: "Settings" }, { label: "Notifications" }]}
      />

      <Notice tone="ok" title="In-app notifications are active">
        Alerts and refill events are scoped to the stations you can access. Reading a notification changes only your own
        read state.
      </Notice>

      {!mailConfigured ? (
        <Notice tone="info" title="SMTP is not configured">
          In-app notifications continue to work. Email and scheduled-report deliveries remain queued without consuming
          attempts until SMTP is configured; transient provider errors are retried automatically.
        </Notice>
      ) : null}

      <section className="card overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3.5">
          <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Your recent delivery status</h2>
          <p className="mt-0.5 text-[0.75rem] text-[var(--ink-3)]">
            The newest 30 email and in-app delivery records for your account. Secrets and message payloads are not shown.
          </p>
        </div>
        {deliveries.length === 0 ? (
          <div className="px-5 py-8 text-center text-[0.8125rem] text-[var(--ink-2)]">
            No delivery attempts have been recorded for your account yet.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[0.8125rem] font-medium capitalize text-[var(--ink)]">
                      {delivery.channel === "email" && delivery.scheduledReportRunId ? "Scheduled report email" : `${delivery.channel} notification`}
                    </p>
                    <Badge tone={statusTone(delivery.status)}>{delivery.status}</Badge>
                  </div>
                  <p className="mt-1 break-all text-[0.75rem] text-[var(--ink-2)]">{delivery.recipient}</p>
                  <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)]">
                    Created {formatDateTimeInTimeZone(delivery.createdAt, timeZone)} ({timeZone}) · {delivery.attemptCount} of {delivery.maxAttempts} attempts
                    {delivery.deliveredAt ? ` · delivered ${formatDateTimeInTimeZone(delivery.deliveredAt, timeZone)}` : ""}
                    {delivery.nextAttemptAt ? ` · retry ${formatDateTimeInTimeZone(delivery.nextAttemptAt, timeZone)}` : ""}
                  </p>
                  {delivery.lastError ? (
                    <p className="mt-1 text-[0.6875rem] text-[var(--crit)]">{delivery.lastError}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
