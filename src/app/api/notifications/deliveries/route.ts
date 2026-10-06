import { listUserNotificationDeliveries } from "@/server/db/repo/deliveries";
import { jsonError, jsonOk, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("notifications.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 30) || 30));
    const rows = await listUserNotificationDeliveries(ctx.user.organizationId, ctx.user.id, limit);
    return jsonOk({ rows, total: rows.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
