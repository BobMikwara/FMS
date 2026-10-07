import { after } from "next/server";

import { queryOne } from "../db/client";
import { listOrganizations } from "../db/repo/core";
import { clearExpiredMfaChallenges, clearExpiredMfaEnrollments } from "../db/repo/security";
import { sweepDeviceHealth } from "../engine/fuel";
import { processNotificationDeliveries } from "./notification-delivery-worker";
import { processScheduledReports } from "./scheduled-reports";

/**
 * The maintenance sweep and the triggers that start it.
 *
 * Vercel Hobby allows a Cron job to fire at most once per day, so the checked-in
 * `vercel.json` schedules `/api/cron/maintenance` daily. A daily sweep is far too
 * coarse for the default ten-minute device-offline threshold — a probe that dies
 * in the morning would not raise an offline alert until the next night — so the
 * very same sweep is also started opportunistically from request traffic: device
 * telemetry ingest and authenticated API calls.
 *
 * A durable lease in `rate_limit_buckets` keeps that to at most one sweep per
 * interval across every serverless instance, and the daily Cron stays as the
 * guaranteed floor for a deployment that receives no traffic at all.
 */

export const DEFAULT_SWEEP_INTERVAL_SECONDS = 300;
export const MIN_SWEEP_INTERVAL_SECONDS = 60;

/** Reuses the atomic rate-limit bucket table; the key namespace is disjoint from `user:*`. */
const SWEEP_LEASE_KEY = "maintenance:sweep";

export interface DeviceHealthSweepResult {
  organizationId: string;
  offline: number;
  restored: number;
}

export interface MaintenanceSweepSummary {
  processed: number;
  results: DeviceHealthSweepResult[];
  scheduledReports: Awaited<ReturnType<typeof processScheduledReports>>;
  deliveries: Awaited<ReturnType<typeof processNotificationDeliveries>>;
  clearedMfaChallenges: number;
  clearedMfaEnrollments: number;
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
 * How often the opportunistic sweep may run. Values below one minute are ignored
 * so a misconfigured deployment cannot turn every request into a sweep.
 */
export function sweepIntervalSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(env.MAINTENANCE_SWEEP_INTERVAL_SECONDS);
  if (!Number.isFinite(configured) || configured < MIN_SWEEP_INTERVAL_SECONDS) {
    return DEFAULT_SWEEP_INTERVAL_SECONDS;
  }
  return Math.floor(configured);
}

/** Whether enough wall-clock time has passed since the last attempt. */
export function intervalElapsed(lastAttemptAt: number, now: number, intervalMs: number): boolean {
  if (!Number.isFinite(lastAttemptAt) || !Number.isFinite(now)) return false;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return true;
  return now - lastAttemptAt >= intervalMs;
}

/**
 * Claims the next maintenance window. The upsert is a single atomic statement, so
 * concurrent instances compete for the same row and exactly one of them sees
 * `count === 1`. Returns `false` when another sweep already owns this window.
 */
export async function claimSweepLease(intervalSeconds: number, now = Date.now()): Promise<boolean> {
  const windowMs = Math.max(1, Math.floor(intervalSeconds)) * 1000;
  const resetAt = now + windowMs;
  const row = await queryOne<{ count: number }>(
    `INSERT INTO rate_limit_buckets (key, count, reset_at)
     VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit_buckets.reset_at <= ? THEN 1 ELSE rate_limit_buckets.count + 1 END,
       reset_at = CASE WHEN rate_limit_buckets.reset_at <= ? THEN ? ELSE rate_limit_buckets.reset_at END
     RETURNING count`,
    [SWEEP_LEASE_KEY, resetAt, now, now, resetAt],
  );
  return Number(row?.count ?? 1) === 1;
}

/**
 * One full maintenance pass: device health per active organization, due scheduled
 * reports, the notification delivery queue, and expired MFA state.
 *
 * Every step is idempotent and claim-guarded at the database level, so overlapping
 * sweeps are safe — the daily Cron and an opportunistic sweep may collide without
 * duplicating work.
 */
export async function runMaintenanceSweep(): Promise<MaintenanceSweepSummary> {
  const organizations = await listOrganizations();
  const activeOrganizations = organizations.filter((organization) => organization.isActive);
  // One organization at a time. Each device-health pass runs in a transaction and
  // the runtime pool holds a single connection, so overlapping passes cannot run
  // in parallel anyway — they would only keep that connection reserved for longer
  // and delay whatever request traffic needs it next.
  const results = await mapWithConcurrency(activeOrganizations, 1, async (organization) => ({
    organizationId: organization.id,
    ...(await sweepDeviceHealth(organization.id)),
  }));
  const scheduledReports = await processScheduledReports();
  const deliveries = await processNotificationDeliveries();
  const now = new Date().toISOString();
  const clearedMfaChallenges = await clearExpiredMfaChallenges(now);
  const clearedMfaEnrollments = await clearExpiredMfaEnrollments(now);
  return {
    processed: results.length,
    results,
    scheduledReports,
    deliveries,
    clearedMfaChallenges,
    clearedMfaEnrollments,
  };
}

/**
 * Runs a sweep if this instance can claim the window. Never throws: an
 * opportunistic sweep is best-effort and must not surface on a user request.
 */
export async function startMaintenanceSweep(reason: string): Promise<MaintenanceSweepSummary | null> {
  try {
    if (!(await claimSweepLease(sweepIntervalSeconds()))) return null;
    return await runMaintenanceSweep();
  } catch (error) {
    console.error(`[maintenance] opportunistic sweep failed (${reason})`, error);
    return null;
  }
}

let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Asks for a sweep without delaying the caller. Cheap enough to call on every
 * request: the in-process timestamp short-circuits all but one attempt per
 * interval per instance.
 *
 * The sweep itself is handed to `after`, so none of its work starts until the
 * response has been sent. That matters because the sweep opens transactions and
 * the runtime holds a single pooled database connection: started inline, its
 * queries would queue ahead of the ones the user's request is waiting for and
 * could hold the request open past its deadline — which is exactly what left
 * data panels such as the tank Usage and Usage Replay views loading forever.
 */
export function scheduleMaintenanceSweep(reason: string): void {
  const now = Date.now();
  if (inFlight) return;
  if (!intervalElapsed(lastAttemptAt, now, sweepIntervalSeconds() * 1000)) return;
  lastAttemptAt = now;

  const start = (): Promise<void> => {
    const task = startMaintenanceSweep(reason).then(
      () => undefined,
      () => undefined,
    );
    inFlight = task;
    const release = () => {
      if (inFlight === task) inFlight = null;
    };
    return task.then(release, release);
  };

  try {
    // `after` runs once the response is on its way and keeps the serverless
    // function alive until the sweep settles.
    after(start);
  } catch {
    // Outside a request scope (scripts, tests): run it unmanaged instead.
    void start();
  }
}

/** Test hook: clears the in-process attempt tracking between cases. */
export function resetMaintenanceSweepState(): void {
  lastAttemptAt = 0;
  inFlight = null;
}
