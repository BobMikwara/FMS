import { NextResponse } from "next/server";
import type { SessionUser } from "../auth/session";
import { getCurrentUser, hasPermission } from "../auth/session";
import { queryOne } from "../db/client";
import { createAuditLog } from "../db/repo/core";

/**
 * Shared API plumbing: consistent response envelopes, validation, auth,
 * authorization, rate limiting and error normalisation (PRD §22, §23).
 */

export interface ApiContext {
  user: SessionUser;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, "bad_request", details);
export const unauthorized = (message = "Your session has expired. Please sign in again.") =>
  new ApiError(401, message, "unauthorized");
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new ApiError(403, message, "forbidden");
export const notFound = (message = "The requested resource was not found.") => new ApiError(404, message, "not_found");
export const conflict = (message: string) => new ApiError(409, message, "conflict");
export const unprocessable = (message: string, details?: unknown) =>
  new ApiError(422, message, "validation_error", details);
export const tooManyRequests = (message = "Too many requests. Please slow down and try again shortly.") =>
  new ApiError(429, message, "rate_limited");
export const serverError = (message = "Something went wrong on our side. Please try again.") =>
  new ApiError(500, message, "internal_error");

/**
 * SQLite raises `SQLITE_CONSTRAINT_UNIQUE` (code 2067) when a UNIQUE index is
 * violated. Rather than surfacing that as an opaque 500, every create path runs
 * its insert through this helper so the user gets a sentence they can act on.
 */
/**
 * Turns a database uniqueness violation into a 409 that names the field the
 * user has to change. Anything else is rethrown untouched so it keeps bubbling
 * up as a real error instead of being mislabelled as a conflict.
 *
 * `node:sqlite` reports the failure as `{ code: "ERR_SQLITE_ERROR", errcode: 2067 }`
 * (2067 = SQLITE_CONSTRAINT_UNIQUE) while better-sqlite3 and Postgres use
 * `SQLITE_CONSTRAINT_UNIQUE` / `23505`, so all three shapes are accepted.
 */
export function uniqueViolation(error: unknown, label: string, field: string): never {
  const err = error as { code?: string; errcode?: number; message?: string } | null;
  const isUnique =
    err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    err?.code === "23505" ||
    (err?.code === "ERR_SQLITE_ERROR" && err?.errcode === 2067) ||
    (typeof err?.message === "string" && /UNIQUE constraint failed/i.test(err.message));
  if (isUnique) {
    throw conflict(`${label} is already in use. Choose a different ${field}.`);
  }
  throw error;
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonCreated<T>(data: T) {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function jsonError(error: ApiError | Error, request?: Request) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code ?? "error",
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }
  // Never leak stack traces to the client.
  console.error("[api] unhandled error", error);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "internal_error",
        message: "Something went wrong on our side. Our team has been notified. Please try again.",
        requestId: request?.headers.get("x-request-id") ?? undefined,
      },
    },
    { status: 500 },
  );
}

export function parsePagination(searchParams: URLSearchParams, defaultPageSize = 25, max = 200) {
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const pageSize = Math.min(max, Math.max(1, Number(searchParams.get("pageSize") ?? defaultPageSize) || defaultPageSize));
  return { page, pageSize };
}

/* -------------------------------------------------------------------------- */
/* Rate limiting (durable and atomic across Vercel instances)                */
/* -------------------------------------------------------------------------- */

export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<void> {
  const now = Date.now();
  const resetAt = now + windowSeconds * 1000;
  const row = await queryOne<{ count: number }>(
    `INSERT INTO rate_limit_buckets (key, count, reset_at)
     VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limit_buckets.reset_at <= ? THEN 1 ELSE rate_limit_buckets.count + 1 END,
       reset_at = CASE WHEN rate_limit_buckets.reset_at <= ? THEN ? ELSE rate_limit_buckets.reset_at END
     RETURNING count`,
    [key, resetAt, now, now, resetAt],
  );
  if (Number(row?.count ?? 0) > max) throw tooManyRequests();
}

export function rateLimitConfig() {
  return {
    max: Number(process.env.RATE_LIMIT_MAX ?? 240),
    windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
  };
}

/* -------------------------------------------------------------------------- */
/* Auth wrappers                                                              */
/* -------------------------------------------------------------------------- */

type Handler<T> = (request: Request, ctx: ApiContext & { params?: Record<string, string> }) => Promise<Response> | Response;

/**
 * Next.js route context. Typed so the route type validator accepts our wrapped
 * handlers for dynamic segments (`[id]`) — `params` must be a `Promise`.
 */
type RouteCtx = { params: Promise<unknown> };

type WrappedHandler = (request: Request, context: RouteCtx) => Promise<Response>;

/** Requires an authenticated user. */
export function withAuth<T>(handler: Handler<T>): WrappedHandler {
  return async (request: Request, routeCtx?: RouteCtx): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) return jsonError(unauthorized(), request);
      const { max, windowSeconds } = rateLimitConfig();
      await rateLimit(`user:${user.id}`, max, windowSeconds);
      const resolved = routeCtx?.params ? await routeCtx.params : undefined;
      const params = (resolved ?? undefined) as Record<string, string> | undefined;
      return await handler(request, { user, params });
    } catch (error) {
      return jsonError(error as Error, request);
    }
  };
}

/** Requires an authenticated user holding `permission`. */
export function withPermission<T>(permission: string, handler: Handler<T>): WrappedHandler {
  return withAuth<T>(async (request, ctx) => {
    if (!hasPermission(ctx.user, permission)) return jsonError(forbidden(), request);
    return handler(request, ctx);
  });
}

/** Requires any of `permissions`. */
export function withAnyPermission<T>(permissions: string[], handler: Handler<T>): WrappedHandler {
  return withAuth<T>(async (request, ctx) => {
    if (!permissions.some((p) => hasPermission(ctx.user, p))) return jsonError(forbidden(), request);
    return handler(request, ctx);
  });
}

/* -------------------------------------------------------------------------- */
/* Body parsing + validation                                                  */
/* -------------------------------------------------------------------------- */

export async function parseJsonBody<T>(request: Request): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return raw as T;
}

export async function parseFormBody(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    out[key] = typeof value === "string" ? value : "";
  }
  return out;
}

export function str(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value);
}

export function num(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function optionalNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bool(value: unknown, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return value === "true" || value === "1" || value === "on" || value === "yes";
}

export function required(value: unknown, field: string): string {
  const text = str(value).trim();
  if (!text) throw unprocessable(`${field} is required.`, { field });
  return text;
}

export function maxLen(value: string, max: number, field: string): string {
  if (value.length > max) throw unprocessable(`${field} must be ${max} characters or fewer.`, { field });
  return value;
}

/* -------------------------------------------------------------------------- */
/* Audit helper                                                               */
/* -------------------------------------------------------------------------- */

export async function audit(input: {
  user: SessionUser;
  action: string;
  entity: string;
  entityId?: string | null;
  entityLabel?: string | null;
  summary: string;
  previous?: unknown;
  next?: unknown;
  request?: Request;
}): Promise<void> {
  let ip: string | null = null;
  let userAgent: string | null = null;
  if (input.request) {
    ip =
      input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      input.request.headers.get("x-real-ip") ??
      null;
    userAgent = input.request.headers.get("user-agent");
  }
  (await createAuditLog({
    userId: input.user.id,
    userLabel: input.user.name,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    summary: input.summary,
    previous: input.previous,
    next: input.next,
    ip,
    userAgent,
  }));
}

export function clientIp(request: Request): string | null {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null
  );
}
