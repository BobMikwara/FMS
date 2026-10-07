"use client";

/**
 * Browser-side helper for calling the SmartFuel JSON API.
 *
 * Every panel that loads its own data goes through here so that a request can
 * only ever end in one of two ways: resolved data, or a thrown error with a
 * sentence an operator can act on. In particular a request that never answers
 * (a stalled serverless function, a dropped connection, a proxy that holds the
 * socket open) is aborted by a deadline and surfaced as an error, so the screen
 * can show an error state with a Retry action instead of a skeleton forever.
 */

/** How long a data request may take before it is given up on. */
export const API_TIMEOUT_MS = 20_000;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string })?.name === "AbortError";
}

function messageForStatus(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to view this data.";
  if (status === 404) return "This data is no longer available.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status === 504 || status === 408) return "The server took too long to respond. Please try again.";
  if (status >= 500) return "The server could not return this data. Please try again.";
  return "Could not load this data. Please try again.";
}

/**
 * Fetches `url` and returns the `data` field of the standard `{ ok, data }`
 * envelope. `signal` cancels the request (a period change or an unmount);
 * `timeoutMs` is the deadline after which the request is abandoned.
 *
 * Throws `ApiRequestError` for anything else, and rethrows the caller's abort
 * untouched so a cancelled request is never mistaken for a failure.
 */
export async function fetchApiData<T>(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const { signal, timeoutMs = API_TIMEOUT_MS } = options;
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    } catch (error) {
      if (timedOut) throw new ApiRequestError("The server took too long to respond. Please try again.", null, "timeout");
      if (signal?.aborted) throw error;
      throw new ApiRequestError("Could not reach the server. Please check your connection and try again.", null, "network");
    }

    // A failed response is not always JSON (a proxy error page, an empty body),
    // so the status decides the message when the envelope cannot be read.
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; data?: T; error?: { message?: string; code?: string } }
      | null;

    if (!payload || typeof payload !== "object" || payload.ok !== true) {
      const message = payload?.error?.message ?? messageForStatus(response.status);
      throw new ApiRequestError(message, response.status, payload?.error?.code ?? null);
    }
    return payload.data as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
