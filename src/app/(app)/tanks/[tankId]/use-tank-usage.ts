"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageRangeRequest, UsageReport } from "@/lib/tank-usage";

export type TankUsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: UsageReport }
  | { status: "error"; message: string };

async function fetchUsage(tankId: string, request: UsageRangeRequest, signal: AbortSignal): Promise<UsageReport> {
  const params = new URLSearchParams({ range: request.preset });
  if (request.preset === "custom") {
    params.set("start", request.start ?? "");
    params.set("end", request.end ?? "");
  }
  let response: Response;
  try {
    response = await fetch(`/api/tanks/${tankId}/usage?${params.toString()}`, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Could not reach the server. Please try again.");
  }
  const payload = await response.json().catch(() => null);
  if (!payload?.ok) throw new Error(payload?.error?.message ?? "Could not load fuel usage. Please try again.");
  return payload.data as UsageReport;
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
