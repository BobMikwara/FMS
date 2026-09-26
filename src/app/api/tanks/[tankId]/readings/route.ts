import { getTank } from "@/server/db/repo/stations";
import { latestReadingForTank, listReadings, readingsForTank } from "@/server/db/repo/readings";
import { isoDaysAgo } from "@/lib/utils";
import { jsonError, jsonOk, notFound, parsePagination, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

/**
 * Raw device readings for a tank.
 *
 * `?series=true` returns the down-sampled series used by charts (max ~600
 * points) so the browser never receives thousands of raw rows.
 */
export const GET = withPermission("readings.view", async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const tank = getTank(tankId);
    if (!tank || tank.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);

    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? isoDaysAgo(1);
    const to = params.get("to") ?? new Date().toISOString();

    if (params.get("series") === "true") {
      const rows = readingsForTank(tankId, from, to, 5000);
      const stride = Math.max(1, Math.ceil(rows.length / 600));
      const sampled = rows.filter((_, index) => index % stride === 0 || index === rows.length - 1);
      return jsonOk({
        tankId,
        from,
        to,
        count: rows.length,
        sampled: sampled.length,
        stride,
        readings: sampled.map((reading) => ({
          ts: reading.ts,
          volumeLiters: reading.volumeLiters,
          levelPercent: reading.levelPercent,
          temperatureC: reading.temperatureC,
          waterLevelMm: reading.waterLevelMm,
          signal: reading.signal,
          batteryPct: reading.batteryPct,
        })),
      });
    }

    const { page, pageSize } = parsePagination(params, 50, 500);
    const result = listReadings({ orgId: ctx.user.organizationId, tankId, from, to, page, pageSize });
    return jsonOk({
      rows: result.rows,
      total: result.total,
      page,
      pageSize,
      latest: latestReadingForTank(tankId),
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
