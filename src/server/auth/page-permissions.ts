import { hasOrganizationWideStationAccess } from "./authorization";
import { hasPermission } from "./permissions";
import type { SessionUser } from "./permissions";

const EXACT_PAGE_PERMISSIONS: Record<string, string> = {
  "/": "dashboard.view",
  "/stations": "stations.view",
  "/stations/new": "stations.create",
  "/tanks": "tanks.view",
  "/tanks/new": "tanks.create",
  "/devices": "devices.view",
  "/devices/new": "devices.create",
  "/vehicles": "vehicles.view",
  "/vehicles/new": "vehicles.create",
  "/alerts": "alerts.view",
  "/alerts/rules": "alert_rules.view",
  "/alerts/rules/new": "alert_rules.manage",
  "/movements": "movements.view",
  "/map": "map.view",
  "/reports": "reports.view",
  "/reports/new": "reports.create",
  "/reports/scheduled": "reports.schedule",
  "/audit-logs": "audit.view",
  "/settings": "settings.view",
  "/settings/system": "settings.manage",
  "/settings/notifications": "settings.manage",
  "/settings/fuel-types": "fuel_types.manage",
  "/admin/users": "users.view",
  "/admin/users/new": "users.create",
  "/admin/roles": "roles.view",
  "/admin/integrations": "integrations.view",
  "/admin/organizations": "organizations.manage",
};

/**
 * Maps app-router page paths to the permission required to render their server
 * components. Unknown paths fail closed in the shared authenticated layout.
 */
export function permissionForPagePath(pathname: string): string | null {
  const path = normalizePath(pathname);
  const exact = EXACT_PAGE_PERMISSIONS[path];
  if (exact) return exact;

  if (/^\/stations\/[^/]+\/edit$/.test(path)) return "stations.edit";
  if (/^\/stations\/[^/]+$/.test(path)) return "stations.view";
  if (/^\/tanks\/[^/]+$/.test(path)) return "tanks.view";
  if (/^\/vehicles\/[^/]+\/edit$/.test(path)) return "vehicles.edit";
  if (/^\/reports\/[^/]+$/.test(path)) return "reports.view";

  return null;
}

export function canAccessPagePath(user: SessionUser, pathname: string): boolean {
  const path = normalizePath(pathname);
  if (path === "/stations/new" && !hasOrganizationWideStationAccess(user)) return false;
  const permission = permissionForPagePath(path);
  return permission !== null && hasPermission(user, permission);
}

function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}
