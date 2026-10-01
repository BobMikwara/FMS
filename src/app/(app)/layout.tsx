import { stationScopeForUser } from "@/server/auth/authorization";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { canAccessPagePath } from "@/server/auth/page-permissions";
import { ensureSchema } from "@/server/db/client";
import { AppShell } from "@/components/layout/app-shell";
import { listAlerts } from "@/server/db/repo/alerts";
import { countUnreadNotifications } from "@/server/db/repo/core";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const pathname = (await headers()).get("x-smartfuel-path");
  if (!pathname || !canAccessPagePath(user, pathname)) notFound();

  let alertCount = 0;
  let unread = 0;
  try {
    (await ensureSchema());
    alertCount = hasPermission(user, "alerts.view")
      ? (await listAlerts({ orgId: user.organizationId, status: "active", pageSize: 200, stationIds: stationScopeForUser(user) })).total
      : 0;
    unread = hasPermission(user, "notifications.view")
      ? await countUnreadNotifications(user.organizationId, user.id, stationScopeForUser(user))
      : 0;
  } catch (error) {
    console.error("[layout] failed to load shell counters", error);
  }

  return (
    <AppShell user={user} alertCount={alertCount} unreadNotifications={unread}>
      {children}
    </AppShell>
  );
}
