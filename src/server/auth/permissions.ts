/**
 * Session identity types and permission checks.
 *
 * Kept free of `next/headers` so client components (app shell, command palette)
 * can import the types and the pure predicate without pulling in the server-only
 * cookie handling.
 */

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  orgId: string;
  roleId: string;
  roleKey: string;
  permissions: string[];
  sessionVersion?: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  /** Station allow-list. An empty list grants network-wide access only to admin/owner roles. */
  stationIds: string[];
}

/**
 * True when the user holds `permission`.
 *
 * The `*` wildcard and legacy `owner` role grant everything. This is the single
 * place the UI asks "may I show / do this?". The API layer repeats the check
 * server-side so a crafted request can never bypass it.
 */
export function hasPermission(user: SessionUser | null, permission: string): boolean {
  if (!user) return false;
  if (user.permissions.includes("*")) return true;
  if (user.roleKey === "super_admin" || user.roleKey === "owner") return true;
  return user.permissions.includes(permission);
}

/** True when the user holds at least one of `permissions`. */
export function hasAnyPermission(user: SessionUser | null, permissions: string[]): boolean {
  if (!user) return false;
  if (user.permissions.includes("*") || user.roleKey === "super_admin" || user.roleKey === "owner") return true;
  return permissions.some((permission) => hasPermission(user, permission));
}
