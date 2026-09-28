import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { User } from "../domain/types";
import {
  createResetToken,
  consumeResetToken,
  getOrganization,
  getUser,
  getUserByEmail,
  listUsers,
  updateUser,
} from "../db/repo/core";

// Session identity + permission predicates live in a dependency-free module so
// client components can import them without pulling in `next/headers`.
export type { SessionPayload, SessionUser } from "./permissions";
export { hasPermission, hasAnyPermission } from "./permissions";
import type { SessionPayload, SessionUser } from "./permissions";

/**
 * Session + authentication.
 *
 * * Stateless JWT session cookie (httpOnly, SameSite=Lax, Secure in prod).
 * * Passwords hashed with bcrypt (cost 12).
 * * Account lockout after repeated failures.
 * * Password reset via single-use, hashed, expiring tokens.
 * * Permissions are carried in the token so the API layer can enforce them
 *   without a database round-trip on every request, and are re-read from the
 *   role definition whenever the user record is loaded.
 */

const COOKIE_NAME = "smartfuel_session";
const ALG = "HS256";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set to at least 32 characters in production");
    }
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-000000000000000000000000");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function sessionMaxAge(): number {
  return Number(process.env.SESSION_MAX_AGE_SECONDS ?? 43_200);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    orgId: payload.orgId,
    roleId: payload.roleId,
    roleKey: payload.roleKey,
    permissions: payload.permissions,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("smartfuel")
    .setAudience("smartfuel-web")
    .setJti(randomUUID())
    .setExpirationTime(Math.floor(Date.now() / 1000) + sessionMaxAge())
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: "smartfuel",
      audience: "smartfuel-web",
    });
    if (!payload.sub || typeof payload.orgId !== "string") return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      orgId: String(payload.orgId),
      roleId: String(payload.roleId ?? ""),
      roleKey: String(payload.roleKey ?? ""),
      permissions: Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [],
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAge(),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function readSessionCookie(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Resolves the current session into a full user (with live permissions).
 * Falls back to the token claims if the user record has since been deleted.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const payload = await readSessionCookie();
  if (!payload) return null;
  const user = (await getUser(payload.sub));
  const organization = (await getOrganization(payload.orgId));
  if (!user || user.status !== "active") return null;
  if (!organization) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    organizationName: organization.name,
    roleId: user.roleId,
    roleKey: user.roleKey,
    roleName: user.roleName,
    permissions: user.permissions,
    stationIds: user.stationIds,
  };
}

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

export interface LoginResult {
  ok: boolean;
  error?: string;
  user?: SessionUser;
}

const MAX_FAILED_ATTEMPTS = 6;
const LOCK_MINUTES = 15;

export async function authenticate(email: string, password: string, ip?: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const record = (await getUserByEmail(normalized));
  if (!record) {
    // Constant-ish work to avoid user enumeration timing.
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    return { ok: false, error: "Incorrect email or password." };
  }

  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(record.lockedUntil).getTime() - Date.now()) / 60000);
    return { ok: false, error: `Account locked after too many failed attempts. Try again in ${minutes} minute(s).` };
  }

  if (record.status !== "active") {
    return { ok: false, error: "This account has been suspended. Contact your administrator." };
  }

  const valid = await verifyPassword(password, record.passwordHash);
  if (!valid) {
    const attempts = (record.failedAttempts ?? 0) + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    (await updateUser(record.id, {
      failedAttempts: attempts,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : undefined,
    }));
    return { ok: false, error: "Incorrect email or password." };
  }

    (await updateUser(record.id, {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: ip ?? undefined,
    }));

  const organization = (await getOrganization(record.organizationId));
  const user: SessionUser = {
    id: record.id,
    email: record.email,
    name: record.name,
    organizationId: record.organizationId,
    organizationName: organization?.name ?? "Unknown organization",
    roleId: record.roleId,
    roleKey: record.roleKey,
    roleName: record.roleName,
    permissions: record.permissions,
    stationIds: record.stationIds,
  };
  return { ok: true, user };
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

export async function requestPasswordReset(email: string): Promise<{ token: string; user: Pick<User, "email" | "name"> } | null> {
  const record = (await getUserByEmail(email.trim().toLowerCase()));
  if (!record) return null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  (await createResetToken(record.id, tokenHash, new Date(Date.now() + 60 * 60 * 1000).toISOString()));
  return { token, user: { email: record.email, name: record.name } };
}

export async function completePasswordReset(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const userId = (await consumeResetToken(tokenHash));
  if (!userId) return { ok: false, error: "This reset link is invalid or has expired." };
  const user = (await getUser(userId));
  if (!user) return { ok: false, error: "This reset link is invalid or has expired." };
  const passwordHash = await hashPassword(newPassword);
  (await updateUser(userId, { passwordHash, failedAttempts: 0, lockedUntil: null }));
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Device ingest credentials                                                  */
/* -------------------------------------------------------------------------- */

/** Devices authenticate to the ingest endpoint with a per-device API key. */
export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function verifyDeviceKey(key: string, hash: string | null): boolean {
  if (!hash) return false;
  const candidate = createHash("sha256").update(key).digest("hex");
  return candidate.length === hash.length && timingSafeEqual(candidate, hash);
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { listUsers };
