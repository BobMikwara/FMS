import { stationScopeForUser } from "@/server/auth/authorization";
import { countUnreadNotifications, listNotifications, markNotificationsRead } from "@/server/db/repo/core";
import { jsonError, jsonOk, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("notifications.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 30) || 30, 1), 100);
    const rows = await listNotifications(ctx.user.organizationId, limit, ctx.user.id, stationScopeForUser(ctx.user));
    return jsonOk({
      rows,
      unread: (await countUnreadNotifications(ctx.user.organizationId, ctx.user.id, stationScopeForUser(ctx.user))),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("notifications.view", async (request, ctx) => {
  try {
    const body = await parseJsonBody<{ action?: string; id?: string }>(request).catch(() => ({}) as { action?: string; id?: string });
    const action = body.action ?? "read-all";
    const updated = action === "read-one" && body.id
      ? (await markNotificationsRead(ctx.user.organizationId, [body.id], ctx.user.id, stationScopeForUser(ctx.user)))
      : action === "read-all"
        ? (await markNotificationsRead(ctx.user.organizationId, undefined, ctx.user.id, stationScopeForUser(ctx.user)))
        : 0;
    return jsonOk({
      updated,
      rows: await listNotifications(ctx.user.organizationId, 30, ctx.user.id, stationScopeForUser(ctx.user)),
      unread: await countUnreadNotifications(ctx.user.organizationId, ctx.user.id, stationScopeForUser(ctx.user)),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
