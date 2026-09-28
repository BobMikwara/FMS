import { countUnreadNotifications, listNotifications, markNotificationsRead } from "@/server/db/repo/core";
import { jsonError, jsonOk, parseJsonBody, withAuth } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 30) || 30, 1), 100);
    const rows = await listNotifications(ctx.user.organizationId, limit, ctx.user.id);
    return jsonOk({
      rows,
      unread: (await countUnreadNotifications(ctx.user.organizationId, ctx.user.id)),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withAuth(async (request, ctx) => {
  try {
    const body = await parseJsonBody<{ action?: string; id?: string }>(request).catch(() => ({}) as { action?: string; id?: string });
    const action = body.action ?? "read-all";
    const updated = action === "read-one" && body.id
      ? (await markNotificationsRead(ctx.user.organizationId, [body.id], ctx.user.id))
      : action === "read-all"
        ? (await markNotificationsRead(ctx.user.organizationId, undefined, ctx.user.id))
        : 0;
    return jsonOk({
      updated,
      rows: await listNotifications(ctx.user.organizationId, 30, ctx.user.id),
      unread: await countUnreadNotifications(ctx.user.organizationId, ctx.user.id),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
