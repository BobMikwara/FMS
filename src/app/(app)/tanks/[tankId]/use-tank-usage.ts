"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageRangeRequest, UsageReport } from "@/lib/tank-usage";

export type TankUsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: UsageReport }
  | { status: "error"; message: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUsageReport(value: unknown): value is UsageReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<UsageReport>;
  if (
    typeof report.timeZone !== "string" ||
    !["today", "week", "month", "custom"].includes(report.preset ?? "") ||
    typeof report.startDate !== "string" ||
    typeof report.endDate !== "string" ||
    typeof report.requestedStartDate !== "string" ||
    typeof report.from !== "string" ||
    typeof report.to !== "string" ||
    !["hour", "day", "week"].includes(report.interval ?? "") ||
    typeof report.hasData !== "boolean" ||
    (report.dataStart !== null && typeof report.dataStart !== "string")
  ) {
    return false;
  }
  if (
    !report.totals ||
    !isFiniteNumber(report.totals.volume) ||
    !Number.isInteger(report.totals.events) ||
    report.totals.events < 0 ||
    !report.metrics ||
    !Number.isInteger(report.metrics.daysRepresented) ||
    report.metrics.daysRepresented < 0 ||
    !Number.isInteger(report.metrics.completeDays) ||
    report.metrics.completeDays < 0 ||
    typeof report.metrics.includesToday !== "boolean" ||
    typeof report.metrics.startsPartway !== "boolean" ||
    (report.metrics.averagePerDay !== null && !isFiniteNumber(report.metrics.averagePerDay))
  ) {
    return false;
  }
  if (
    (report.metrics.highest !== null &&
      (!report.metrics.highest || typeof report.metrics.highest.date !== "string" || !isFiniteNumber(report.metrics.highest.volume))) ||
    (report.metrics.lowest !== null &&
      (!report.metrics.lowest || typeof report.metrics.lowest.date !== "string" || !isFiniteNumber(report.metrics.lowest.volume)))
  ) {
    return false;
  }
  return Array.isArray(report.buckets) && report.buckets.every(
    (bucket) =>
      Boolean(bucket) &&
      typeof bucket.key === "string" &&
      typeof bucket.endDate === "string" &&
      isFiniteNumber(bucket.volume) &&
      Number.isInteger(bucket.events) &&
      bucket.events >= 0 &&
      typeof bucket.inProgress === "boolean",
  );
}

async function fetchUsage(tankId: string, request: UsageRangeRequest, signal: AbortSignal): Promise<UsageReport> {
  const params = new URLSearchParams({ range: request.preset });
  if (request.preset === "custom") {
    params.set("start", request.start ?? "");
    params.set("end", request.end ?? "");
  }
  let response: Response;
  try {
    response = await fetch(`/api/tanks/${encodeURIComponent(tankId)}/usage?${params.toString()}`, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Could not reach the server. Please try again.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message ?? "Could not load fuel usage. Please try again.");
  }
  if (!isUsageReport(payload.data)) {
    throw new Error("The usage response was not in the expected format. Please try again.");
  }
  return payload.data;
}

/**
 * Loads one usage report for the chosen period. The chart and the summary
 * metrics both read this single result, so they always describe the same period.
 * A request is cancelled when the period changes, and `null` means "nothing valid to load".
 */
export function useTankUsage(tankId: string, request: UsageRangeRequest | null) {
  const [state, setState] = useState<TankUsageState>({ status: request ? "loading" : "idle" });
  const [attempt, setAttempt] = useState(0);
  const preset = request?.preset ?? null;
  const start = request?.start ?? null;
  const end = request?.end ?? null;

  useEffect(() => {
    if (!preset) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchUsage(tankId, { preset, start, end }, controller.signal)
      .then((report) => {
        if (!controller.signal.aborted) setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load fuel usage." });
      });
    return () => controller.abort();
  }, [tankId, preset, start, end, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, reload };
}
