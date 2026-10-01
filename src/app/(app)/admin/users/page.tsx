import { hasOrganizationWideStationAccess, stationScopeForUser, userCanAccessStation, userCanAccessStationScopedUser } from "@/server/auth/authorization";
import Link from "next/link";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listRoles, listUsers } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { UsersBrowser } from "./users-browser";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const users = (await listUsers(user.organizationId, stationScopeForUser(user)))
    .filter((entry) => userCanAccessStationScopedUser(user, entry.stationIds, entry.roleKey));
  const allRoles = await listRoles();
  const roles = hasOrganizationWideStationAccess(user)
    ? allRoles
    : allRoles.filter((role) => !["admin", "super_admin", "owner"].includes(role.key));
  const stations = (await listAllStations(user.organizationId)).filter((station) => userCanAccessStation(user, station.id));
  const stationName = new Map(stations.map((station) => [station.id, station.name]));

  const rows = users.map((entry) => ({
    id: entry.id,
    name: entry.name,
    email: entry.email,
    phone: entry.phone,
    jobTitle: entry.jobTitle,
    status: entry.status,
    roleId: entry.roleId,
    roleName: entry.roleName,
    roleKey: entry.roleKey,
    mfaEnabled: entry.mfaEnabled,
    lastLoginAt: entry.lastLoginAt,
    lastLoginIp: entry.lastLoginIp,
    createdAt: entry.createdAt,
    stationNames: entry.stationIds.filter((id) => userCanAccessStation(user, id)).map((id) => stationName.get(id)).filter((name): name is string => Boolean(name)),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Everyone with access to this organization. Permissions come from the assigned role and are enforced by the API, not just the interface."
        actions={hasPermission(user, "roles.view") || hasPermission(user, "users.create") ? (
          <div className="flex items-center gap-2">
            {hasPermission(user, "roles.view") ? (
              <Link href="/admin/roles" className="btn btn-secondary btn-sm">
                Roles & permissions
              </Link>
            ) : null}
            {hasPermission(user, "users.create") ? (
              <Link href="/admin/users/new" className="btn btn-primary btn-sm">
                Invite user
              </Link>
            ) : null}
          </div>
        ) : undefined}
      />
      <UsersBrowser
        initialRows={rows}
        roles={roles.map((role) => ({ id: role.id, name: role.name, key: role.key }))}
        stations={stations.map((station) => ({ id: station.id, name: station.name }))}
        currentUserId={user.id}
        canCreate={hasPermission(user, "users.create")}
        canEdit={hasPermission(user, "users.edit")}
        canDelete={hasPermission(user, "users.delete")}
        canManageOrganizationWideAccess={hasOrganizationWideStationAccess(user)}
      />
    </div>
  );
}
