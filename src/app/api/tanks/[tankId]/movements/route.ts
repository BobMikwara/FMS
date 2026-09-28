import { getTank } from "@/server/db/repo/stations";
import { listEvents } from "@/server/db/repo/events";
import { isoDaysAgo } from "@/lib/utils";
import { jsonError, jsonOk, notFound, parsePagination, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("movements.view", async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const tank = (await getTank(tankId));
    if (
      !tank ||
      tank.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(tank.stationId))
    ) return jsonError(notFound(), request);

    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 30);
    const result = (await listEvents({
      orgId: ctx.user.organizationId,
      tankId,
      type: params.get("type") ?? undefined,
      search: params.get("search") ?? undefined,
      from: params.get("from") ?? isoDaysAgo(14),
      to: params.get("to") ?? new Date().toISOString(),
      page,
      pageSize,
    }));
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
