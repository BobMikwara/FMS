import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { ensureSchema } from "@/server/db/client";
import { AppShell } from "@/components/layout/app-shell";
import { listAlerts } from "@/server/db/repo/alerts";
import { countUnreadNotifications } from "@/server/db/repo/core";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  let alertCount = 0;
  let unread = 0;
  try {
    (await ensureSchema());
    alertCount = hasPermission(user, "alerts.view")
      ? (await listAlerts({ orgId: user.organizationId, status: "active", pageSize: 200 })).total
      : 0;
    unread = (await countUnreadNotifications(user.organizationId, user.id));
  } catch (error) {
    console.error("[layout] failed to load shell counters", error);
  }

  return (
    <AppShell user={user} alertCount={alertCount} unreadNotifications={unread}>
      {children}
    </AppShell>
  );
}
