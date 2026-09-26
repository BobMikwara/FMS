import { latestReadingForTank } from "@/server/db/repo/readings";
import { listStations, listTanks } from "@/server/db/repo/stations";
import { getCurrentUser } from "@/server/auth/session";
import { getBus, type RealtimeEvent } from "@/server/realtime/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events stream (PRD §56).
 *
 * Pushes live tank levels, alert notifications and heartbeat frames so the
 * dashboard updates without a page refresh. Swapping this for a WebSocket
 * gateway or a Redis/NATS fan-out requires no frontend changes — the client
 * only knows the event names and payload shape.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(
      { ok: false, error: { code: "unauthorized", message: "Authentication required." } },
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const send = (event: string, data: unknown) => {
    if (closed || !streamController) return;
    try {
      streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      cleanup();
    }
  };

  const bus = getBus();
  unsubscribe = bus.subscribe((event: RealtimeEvent) => send(event.type, event));

  const tick = () => send("tick", buildSnapshot(user.organizationId));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      try {
        controller.enqueue(encoder.encode("retry: 3000\n\n"));
      } catch {
        /* client already gone */
      }
      tick();
      timer = setInterval(tick, 3000);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function buildSnapshot(organizationId: string) {
  try {
    const tanks = listTanks({ orgId: organizationId, pageSize: 200, includeArchived: false }).rows;
    const levels = tanks.map((tank) => {
      const reading = latestReadingForTank(tank.id);
      return {
        tankId: tank.id,
        levelPercent: reading?.levelPercent ?? null,
        volumeLiters: reading?.volumeLiters ?? null,
        state: reading ? classify(tank, reading.volumeLiters) : "unknown",
        ts: reading?.ts ?? null,
      };
    });
    const stations = listStations({ orgId: organizationId, pageSize: 200 }).rows;
    return {
      at: new Date().toISOString(),
      totalFuel: levels.reduce((sum, level) => sum + (level.volumeLiters ?? 0), 0),
      levels,
      stationStatus: Object.fromEntries(stations.map((station) => [station.id, station.status])),
    };
  } catch {
    return { at: new Date().toISOString(), levels: [], stationStatus: {} };
  }
}

function classify(
  tank: { capacity: number; criticalThresholdPct: number; lowThresholdPct: number },
  volumeLiters: number,
) {
  const pct = tank.capacity > 0 ? (volumeLiters / tank.capacity) * 100 : 0;
  if (pct < tank.criticalThresholdPct) return "critical";
  if (pct < tank.lowThresholdPct) return "low";
  return "normal";
}
