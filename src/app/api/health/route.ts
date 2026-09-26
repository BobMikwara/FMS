import { ensureSchema, queryOne } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Liveness + readiness probe. Used by the live preview and load balancers. */
export async function GET() {
  try {
    ensureSchema();
    const stations = Number(queryOne<{ n: number }>("SELECT count(*) AS n FROM stations")?.n ?? 0);
    const tanks = Number(queryOne<{ n: number }>("SELECT count(*) AS n FROM tanks")?.n ?? 0);
    return Response.json({
      ok: true,
      status: "healthy",
      service: "smartfuel-api",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      database: { connected: true, stations, tanks },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        status: "degraded",
        service: "smartfuel-api",
        timestamp: new Date().toISOString(),
        database: { connected: false },
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  }
}
