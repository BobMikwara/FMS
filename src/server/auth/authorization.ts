import type { SessionUser } from "./permissions";

/**
 * Organization administrators and platform owners are intentionally granted
 * network-wide operational access. For every other role, station assignment is
 * an allow-list; an empty allow-list grants access to no stations.
 */
export function isPlatformOwner(roleKey: string): boolean {
  return roleKey === "super_admin" || roleKey === "owner";
}

export function hasOrganizationWideStationAccess(user: SessionUser): boolean {
  return isPlatformOwner(user.roleKey) || user.roleKey === "admin";
}

/** Non-administrator roles must always have at least one station assignment. */
export function roleRequiresStationAssignment(roleKey: string): boolean {
  return roleKey !== "admin" && !isPlatformOwner(roleKey);
}

/**
 * Returns `undefined` only for an organization-wide user. An empty array is a
 * meaningful deny-all scope and must not be converted to `undefined` by callers.
 */
export function stationScopeForUser(user: SessionUser): string[] | undefined {
  return hasOrganizationWideStationAccess(user) ? undefined : user.stationIds;
}

export function userCanAccessStation(user: SessionUser, stationId: string | null | undefined): boolean {
  if (!stationId) return false;
  return hasOrganizationWideStationAccess(user) || user.stationIds.includes(stationId);
}

export function userCanAccessOrganization(user: SessionUser, organizationId: string): boolean {
  return user.organizationId === organizationId;
}

export function userCanAccessStationScopedUser(
  user: SessionUser,
  targetStationIds: string[],
  targetRoleKey?: string,
): boolean {
  if (hasOrganizationWideStationAccess(user)) return true;
  // An account with organization-wide authority is never inside a station
  // allow-list, even if it also has station assignments. Matching one station
  // must not reveal or let a scoped caller modify an administrator account.
  if (targetRoleKey === "admin" || (targetRoleKey && isPlatformOwner(targetRoleKey))) return false;
  // A shared account is only in scope when every station it can access is in
  // the caller's allow-list. Matching one station must not grant access to its
  // other assignments or let a scoped user suspend that account.
  return targetStationIds.length > 0 && targetStationIds.every((stationId) => user.stationIds.includes(stationId));
}

/** Returns true only when the current user's station allow-list can include the station. */
export function stationIdAllowed(user: SessionUser, stationId: string): boolean {
  return userCanAccessStation(user, stationId);
}
