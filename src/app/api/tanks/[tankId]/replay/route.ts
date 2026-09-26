import { getTank } from "@/server/db/repo/stations";
import { listEvents } from "@/server/db/repo/events";
import { readingsForTank } from "@/server/db/repo/readings";
import { isoDaysAgo } from "@/lib/utils";
import { jsonError, jsonOk, notFound, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

/**
 * Fuel Usage Replay source data (PRD §47).
 *
 * Returns the measured level series for the window, down-sampled into at most
 * `buckets` points so the timeline scrubber stays smooth in the browser, plus
 * the derived movements (refills / outflow / anomalies) that occurred inside
 * the same window.
 */
export const GET = withPermission("tanks.view", async (request, ctx) => {
  try {
    const tankId = ctx.params?.tankId ?? "";
    const tank = getTank(tankId);
    if (!tank || tank.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);

    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? isoDaysAgo(1);
    const to = params.get("to") ?? new Date().toISOString();
    const buckets = Math.min(Math.max(Number(params.get("buckets") ?? 96) || 96, 8), 500);

    const rows = readingsForTank(tankId, from, to, 50000);
    const stride = Math.max(1, Math.ceil(rows.length / buckets));
    const sampled = rows.filter((_, position) => position % stride === 0 || position === rows.length - 1);

    const points = sampled.map((reading) => ({
      ts: reading.ts,
      volumeLiters: Number(reading.volumeLiters),
      levelPercent:
        reading.levelPercent != null ? Number(reading.levelPercent) : tank.capacity > 0 ? (Number(reading.volumeLiters) / tank.capacity) * 100 : 0,
      temperatureC: reading.temperatureC == null ? null : Number(reading.temperatureC),
    }));

    const events = listEvents({ orgId: ctx.user.organizationId, tankId, from, to, page: 1, pageSize: 200 }).rows;
    const movements = events.map((event) => ({
      id: event.id,
      ts: event.ts,
      type: event.type,
      volume: Number(event.volume),
      label:
        event.type === "refill"
          ? "Refill detected"
          : event.type === "anomaly"
            ? "Possible anomaly detected"
            : event.type === "consumption"
              ? "Tank outflow period"
              : event.type === "delivery"
                ? "Delivery recorded"
                : event.type === "device_offline"
                  ? "Device went offline"
                  : event.type === "device_online"
                    ? "Device came back online"
                    : event.type,
    }));

    const refillEvents = events.filter((event) => event.type === "refill");
    const consumptionEvents = events.filter((event) => event.type === "consumption");

    return jsonOk({
      tankId,
      from,
      to,
      points,
      movements,
      refills: {
        volume: refillEvents.reduce((sum, event) => sum + Number(event.volume), 0),
        count: refillEvents.length,
      },
      consumption: {
        volume: consumptionEvents.reduce((sum, event) => sum + Number(event.volume), 0),
        count: consumptionEvents.length,
      },
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
