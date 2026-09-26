import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listUsers } from "@/server/db/repo/core";
import { getSettings } from "@/server/db/repo/core";
import { PageHeader, Notice } from "@/components/ui/layout";
import { NotificationSettingsForm } from "./notification-settings-form";

export const dynamic = "force-dynamic";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
  in_app: "In-app",
};

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = (await getSettings(user.organizationId));
  const users = (await listUsers(user.organizationId));

  const notifications = (settings.notifications ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Which alerts reach which people, on which channel, and how often summaries are sent."
        breadcrumbs={[{ label: "Settings" }, { label: "Notifications" }]}
      />

      <Notice tone="info" title="Alerts always reach the interface first">
        Every alert appears in the notification centre and on the dashboard regardless of these settings. Email, SMS and
        push are additional channels - turning them off never hides an alert from the people on shift.
      </Notice>

      <NotificationSettingsForm
        initial={{
          channelsEnabled: Array.isArray(notifications.channels)
            ? (notifications.channels as string[])
            : ["in_app", "email"],
          criticalChannels: Array.isArray(notifications.criticalChannels)
            ? (notifications.criticalChannels as string[])
            : ["in_app", "email", "sms"],
          dailyDigest: notifications.dailyDigest === true,
          weeklyDigest: notifications.weeklyDigest !== false,
          quietHoursStart: typeof notifications.quietHoursStart === "string" ? notifications.quietHoursStart : "22:00",
          quietHoursEnd: typeof notifications.quietHoursEnd === "string" ? notifications.quietHoursEnd : "06:00",
          recipients:
            Array.isArray(notifications.recipients) && notifications.recipients.length > 0
              ? (notifications.recipients as string[])
              : users.filter((entry) => entry.status === "active").map((entry) => entry.email),
        }}
        users={users.map((entry) => ({ id: entry.id, name: entry.name, email: entry.email, roleName: entry.roleName }))}
      />

      <section className="card max-w-3xl p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">Channels</h2>
        <dl className="mt-3 space-y-2 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium text-[var(--ink)]">In-app</dt>
            <dd>Always on. Delivered instantly through the real-time channel.</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium text-[var(--ink)]">Email</dt>
            <dd>
              Sent through the organization's mail relay. Requires{" "}
              <code className="rounded bg-[var(--surface-3)] px-1 py-0.5 text-[0.75rem]">SMTP_*</code> environment
              variables; without them the platform records the failure instead of pretending it sent.
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium text-[var(--ink)]">SMS</dt>
            <dd>
              Reserved for critical alerts. Requires an SMS provider credential in the deployment environment.
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium text-[var(--ink)]">Push</dt>
            <dd>Browser push, available once the app is installed as a PWA.</dd>
          </div>
        </dl>
        <p className="mt-3 text-[0.75rem] text-[var(--ink-3)]">
          Active channels: {Object.entries(CHANNEL_LABELS)
            .map(([key, label]) => `${key} → ${label}`)
            .join(", ")}
          .
        </p>
      </section>
    </div>
  );
}
