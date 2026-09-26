import { timingSafeEqual } from "node:crypto";
import { listOrganizations } from "@/server/db/repo/core";
import { sweepDeviceHealth } from "@/server/engine/fuel";

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
 * Vercel Cron entry point for durable maintenance. It replaces an always-on
 * process timer: every instance can run it, and all state changes are persisted
 * in PostgreSQL. Vercel sends the CRON_SECRET as a bearer token.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const organizations = await listOrganizations();
    const results = await Promise.all(
      organizations.filter((organization) => organization.isActive).map(async (organization) => ({
        organizationId: organization.id,
        ...(await sweepDeviceHealth(organization.id)),
      })),
    );
    return Response.json({ ok: true, processed: results.length, results });
  } catch (error) {
    console.error("[cron] maintenance sweep failed", error);
    return Response.json({ ok: false, error: "Maintenance sweep failed" }, { status: 500 });
  }
}
