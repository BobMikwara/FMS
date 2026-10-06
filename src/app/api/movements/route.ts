import { stationScopeForUser } from "@/server/auth/authorization";
import { listEvents, movementTotals } from "@/server/db/repo/events";
import { listAllStations } from "@/server/db/repo/stations";
import { normalizeTimeZone } from "@/server/services/time-zone";
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
    const [result, totals, stations] = await Promise.all([
      listEvents({
        orgId: ctx.user.organizationId,
        stationId,
        tankId: params.get("tankId") ?? undefined,
        type: params.get("type") ?? undefined,
        search: params.get("search") ?? undefined,
        from,
        to,
        page,
        pageSize,
        stationIds: stationScopeForUser(ctx.user),
      }),
      movementTotals(
        ctx.user.organizationId,
        from,
        to,
        stationId,
        undefined,
        stationScopeForUser(ctx.user),
      ),
      listAllStations(ctx.user.organizationId),
    ]);
    const organizationTimeZone = normalizeTimeZone(undefined);
    const stationTimeZoneById = new Map(stations.map((station) => [station.id, normalizeTimeZone(station.timezone, organizationTimeZone)]));
    return jsonOk({
      rows: result.rows.map((event) => ({
        ...event,
        timeZone: stationTimeZoneById.get(event.stationId) ?? organizationTimeZone,
      })),
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
