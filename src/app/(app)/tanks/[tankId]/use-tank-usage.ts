"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApiData, isAbortError } from "@/lib/api-fetch";
import type { UsageRangeRequest, UsageReport } from "@/lib/tank-usage";

export type TankUsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: UsageReport }
  | { status: "error"; message: string };

function usageUrl(tankId: string, request: UsageRangeRequest): string {
  const params = new URLSearchParams({ range: request.preset });
  if (request.preset === "custom") {
    params.set("start", request.start ?? "");
    params.set("end", request.end ?? "");
  }
  return `/api/tanks/${encodeURIComponent(tankId)}/usage?${params.toString()}`;
}

/**
 * Loads one usage report for the chosen period. The chart and the summary
 * metrics both read this single result, so they always describe the same period.
 *
 * A request is cancelled when the period changes, and `null` means "nothing valid
 * to load". Every outcome — data, no data, a failure, a server that never answers
 * — ends in a settled state, so the view is never left loading indefinitely.
 */
export function useTankUsage(tankId: string, request: UsageRangeRequest | null) {
  const [state, setState] = useState<TankUsageState>({ status: request ? "loading" : "idle" });
  const [attempt, setAttempt] = useState(0);
  const preset = request?.preset ?? null;
  const start = request?.start ?? null;
  const end = request?.end ?? null;

  useEffect(() => {
    if (!tankId || !preset) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchApiData<UsageReport>(usageUrl(tankId, { preset, start, end }), { signal: controller.signal })
      .then((report) => {
        if (!controller.signal.aborted) setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load fuel usage." });
      });
    return () => controller.abort();
  }, [tankId, preset, start, end, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, reload };
}
