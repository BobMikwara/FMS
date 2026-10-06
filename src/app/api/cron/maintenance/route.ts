import { timingSafeEqual } from "node:crypto";
import { listOrganizations } from "@/server/db/repo/core";
import { clearExpiredMfaChallenges, clearExpiredMfaEnrollments } from "@/server/db/repo/security";
import { sweepDeviceHealth } from "@/server/engine/fuel";
import { processNotificationDeliveries } from "@/server/services/notification-delivery-worker";
import { processScheduledReports } from "@/server/services/scheduled-reports";

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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Vercel Cron entry point for durable maintenance. It runs every five minutes
 * to support the default ten-minute offline threshold. Vercel sends the
 * CRON_SECRET as a bearer token; database locks make overlapping sweeps safe.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const organizations = await listOrganizations();
    const activeOrganizations = organizations.filter((organization) => organization.isActive);
    const results = await mapWithConcurrency(activeOrganizations, 3, async (organization) => ({
      organizationId: organization.id,
      ...(await sweepDeviceHealth(organization.id)),
    }));
    const scheduledReports = await processScheduledReports();
    const deliveries = await processNotificationDeliveries();
    const now = new Date().toISOString();
    const clearedMfaChallenges = await clearExpiredMfaChallenges(now);
    const clearedMfaEnrollments = await clearExpiredMfaEnrollments(now);
    return Response.json({ ok: true, processed: results.length, results, scheduledReports, deliveries, clearedMfaChallenges, clearedMfaEnrollments });
  } catch (error) {
    console.error("[cron] maintenance sweep failed", error);
    return Response.json({ ok: false, error: "Maintenance sweep failed" }, { status: 500 });
  }
}
