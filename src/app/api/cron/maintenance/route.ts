import { timingSafeEqual } from "node:crypto";
import { runMaintenanceSweep } from "@/server/services/maintenance-sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Vercel Cron entry point for durable maintenance.
 *
 * The checked-in `vercel.json` fires this once a day, which is the most Vercel
 * Hobby allows. That is the guaranteed floor, not the only trigger: the same
 * `runMaintenanceSweep` is also started opportunistically from device telemetry
 * and authenticated API traffic, which is what keeps the default ten-minute
 * device-offline threshold meaningful between daily runs. Vercel sends the
 * CRON_SECRET as a bearer token; database locks make overlapping sweeps safe.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    return Response.json({ ok: true, ...(await runMaintenanceSweep()) });
  } catch (error) {
    console.error("[cron] maintenance sweep failed", error);
    return Response.json({ ok: false, error: "Maintenance sweep failed" }, { status: 500 });
  }
}
