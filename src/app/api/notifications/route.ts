import { countUnreadNotifications, listNotifications, markNotificationsRead } from "@/server/db/repo/core";
import { jsonError, jsonOk, parseJsonBody, withAuth } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 30) || 30, 1), 100);
    const rows = listNotifications(ctx.user.organizationId, limit).map((notification) => ({
      ...notification,
      isRead: notification.userId === ctx.user.id ? notification.isRead : true,
    }));
    return jsonOk({
      rows,
      unread: countUnreadNotifications(ctx.user.organizationId),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withAuth(async (request, ctx) => {
  try {
    const body = await parseJsonBody<{ action?: string; id?: string }>(request).catch(() => ({}) as { action?: string });
    const action = body.action ?? "read-all";
    const updated = action === "read-all" ? markNotificationsRead(ctx.user.id) : 0;
    return jsonOk({
      updated,
      rows: listNotifications(ctx.user.organizationId, 30),
      unread: countUnreadNotifications(ctx.user.organizationId),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
