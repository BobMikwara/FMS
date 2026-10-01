import type { IconName } from "./icons";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  permission?: string;
  badge?: "alerts";
  children?: { label: string; href: string; permission?: string }[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Primary navigation. Mirrors the PRD structure (§5, §95) and merges the
 * build-prompt grouping (Stations / Fuel Monitoring / Vehicles / Alerts /
 * Reports / Administration).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ label: "Dashboard", href: "/", icon: "dashboard", permission: "dashboard.view" }],
  },
  {
    title: "Operations",
    items: [
      {
        label: "Stations",
        href: "/stations",
        icon: "station",
        permission: "stations.view",
        children: [
          { label: "All stations", href: "/stations", permission: "stations.view" },
          { label: "Map view", href: "/map", permission: "map.view" },
        ],
      },
      {
        label: "Tanks",
        href: "/tanks",
        icon: "tank",
        permission: "tanks.view",
        children: [
          { label: "All tanks", href: "/tanks", permission: "tanks.view" },
          { label: "Tank configuration", href: "/tanks?view=config", permission: "tanks.view" },
        ],
      },
      {
        label: "Fuel movement",
        href: "/movements",
        icon: "movement",
        permission: "movements.view",
        children: [
          { label: "Ledger", href: "/movements", permission: "movements.view" },
          { label: "Refueling", href: "/movements?type=refill", permission: "movements.view" },
          { label: "Consumption", href: "/movements?type=consumption", permission: "movements.view" },
          { label: "Suspected loss", href: "/movements?type=anomaly", permission: "movements.view" },
        ],
      },
      {
        label: "Alerts",
        href: "/alerts",
        icon: "alert",
        permission: "alerts.view",
        badge: "alerts",
        children: [
          { label: "Alert centre", href: "/alerts", permission: "alerts.view" },
          { label: "Alert rules", href: "/alerts/rules", permission: "alert_rules.view" },
        ],
      },
    ],
  },
  {
    title: "Fleet",
    items: [
      { label: "Vehicles", href: "/vehicles", icon: "vehicle", permission: "vehicles.view" },
      { label: "GPS devices", href: "/devices?type=gps_tracker", icon: "radar", permission: "devices.view" },
    ],
  },
  {
    title: "Insight",
    items: [
      {
        label: "Reports",
        href: "/reports",
        icon: "report",
        permission: "reports.view",
        children: [
          { label: "All reports", href: "/reports", permission: "reports.view" },
          { label: "Scheduled", href: "/reports/scheduled", permission: "reports.schedule" }
        ],
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        label: "Users & roles",
        href: "/admin/users",
        icon: "users",
        permission: "users.view",
        children: [
          { label: "Users", href: "/admin/users", permission: "users.view" },
          { label: "Roles & permissions", href: "/admin/roles", permission: "roles.view" },
          { label: "Organizations", href: "/admin/organizations", permission: "organizations.manage" },
        ],
      },
      {
        label: "Devices",
        href: "/devices",
        icon: "device",
        permission: "devices.view",
        children: [
          { label: "All devices", href: "/devices", permission: "devices.view" },
          { label: "Fuel probes", href: "/devices?type=fuel_probe", permission: "devices.view" },
          { label: "GPS trackers", href: "/devices?type=gps_tracker", permission: "devices.view" },
        ],
      },
      { label: "Integrations", href: "/admin/integrations", icon: "plug", permission: "integrations.view" },
      {
        label: "Settings",
        href: "/settings",
        icon: "settings",
        permission: "settings.view",
        children: [
          { label: "Organization", href: "/settings", permission: "settings.view" },
          { label: "Fuel types", href: "/settings/fuel-types", permission: "fuel_types.manage" },
          { label: "Notifications", href: "/settings/notifications", permission: "settings.manage" },
          { label: "System", href: "/settings/system", permission: "settings.manage" },
        ],
      },
      { label: "Audit log", href: "/audit-logs", icon: "audit", permission: "audit.view" },
    ],
  },
];

export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isSectionActive(section: NavSection, pathname: string): boolean {
  return section.items.some(
    (item) =>
      isNavItemActive(item.href, pathname) || (item.children ?? []).some((child) => isNavItemActive(child.href, pathname)),
  );
}
