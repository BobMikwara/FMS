export type TelemetryFreshness = "live" | "delayed" | "stale" | "unknown";

export function telemetryFreshness(
  lastValidAt: string | null | undefined,
  options: { liveWithinSeconds: number; staleAfterSeconds: number; now?: number },
): TelemetryFreshness {
  if (!lastValidAt) return "unknown";
  const timestamp = Date.parse(lastValidAt);
  if (!Number.isFinite(timestamp)) return "unknown";

  const now = options.now ?? Date.now();
  const liveLimit = Math.max(0, options.liveWithinSeconds) * 1000;
  const staleLimit = Math.max(liveLimit, options.staleAfterSeconds * 1000);
  const age = Math.max(0, now - timestamp);
  if (age <= liveLimit) return "live";
  if (age < staleLimit) return "delayed";
  return "stale";
}
