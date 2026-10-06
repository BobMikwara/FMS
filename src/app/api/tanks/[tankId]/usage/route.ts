import { userCanAccessStation } from "@/server/auth/authorization";
import { getOrganization } from "@/server/db/repo/core";
import { getStation, getTank } from "@/server/db/repo/stations";
import { consumptionEventsForTank, historyStartForTank } from "@/server/db/repo/usage";
import { normalizeTimeZone } from "@/server/services/time-zone";
import { badRequest, jsonError, jsonOk, notFound, withPermission } from "@/server/api/route";
import { buildUsageReport, parseUsagePreset, resolveUsageRange } from "@/lib/tank-usage";

export const dynamic = "force-dynamic";

/**
 * Fuel usage for one tank over Today, This Week, This Month or a custom period.
 *
 * Read-only. The period is resolved in the tank's own time zone, usage is the
 * sum of recorded `consumption` movements (the same definition as the status
 * card), and one response carries both the chart buckets and the summary
 * metrics so they can never describe different periods.
 *
 *   GET ?range=today|week|month
 *   GET ?range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export const GET = withPermission("movements.view", async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const tank = await getTank(tankId);
    if (!tank || tank.organizationId !== ctx.user.organizationId || !userCanAccessStation(ctx.user, tank.stationId)) {
      return jsonError(notFound(), request);
    }

    const params = new URL(request.url).searchParams;
    const preset = parseUsagePreset(params.get("range"));
    if (!preset) return jsonError(badRequest("Choose Today, This Week, This Month or Custom Date."), request);

    const [station, organization] = await Promise.all([getStation(tank.stationId), getOrganization(tank.organizationId)]);
    const timeZone = normalizeTimeZone(station?.timezone ?? organization?.timezone);
    const resolved = resolveUsageRange(
      { preset, start: params.get("start"), end: params.get("end") },
      new Date(),
      timeZone,
    );
    if (!resolved.ok) return jsonError(badRequest(resolved.error), request);

    const { range } = resolved;
    const [events, dataStart] = await Promise.all([
      consumptionEventsForTank(tank.id, range.from, range.to),
      historyStartForTank(tank.id),
    ]);
    return jsonOk(buildUsageReport({ range, events, dataStart }));
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
