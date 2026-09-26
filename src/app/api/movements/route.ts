import { listEvents, movementTotals } from "@/server/db/repo/events";
import { isoDaysAgo } from "@/lib/utils";
import { jsonError, jsonOk, parsePagination, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("movements.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 30);
    const from = params.get("from") ?? isoDaysAgo(14);
    const to = params.get("to") ?? new Date().toISOString();
    const stationId = params.get("stationId") ?? undefined;
    const result = listEvents({
      orgId: ctx.user.organizationId,
      stationId,
      tankId: params.get("tankId") ?? undefined,
      type: params.get("type") ?? undefined,
      search: params.get("search") ?? undefined,
      from,
      to,
      page,
      pageSize,
    });
    const totals = movementTotals(ctx.user.organizationId, from, to, stationId);
    return jsonOk({
      rows: result.rows,
      total: result.total,
      page,
      pageSize,
      totals: {
        consumption: Math.round(totals.consumption),
        refills: Math.round(totals.refills),
        suspectedLoss: Math.round(totals.suspectedLoss),
      },
      from,
      to,
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
