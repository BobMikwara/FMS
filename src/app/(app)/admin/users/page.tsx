import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";
import { listRoles, listUsers } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { UsersBrowser } from "./users-browser";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const users = listUsers(user.organizationId);
  const roles = listRoles();
  const stations = listAllStations(user.organizationId);
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
    stationNames: entry.stationIds.map((id) => stationName.get(id) ?? id),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Everyone with access to this organization. Permissions come from the assigned role and are enforced by the API, not just the interface."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/roles" className="btn btn-secondary btn-sm">
              Roles & permissions
            </Link>
            <Link href="/admin/users/new" className="btn btn-primary btn-sm">
              Invite user
            </Link>
          </div>
        }
      />
      <UsersBrowser
        initialRows={rows}
        roles={roles.map((role) => ({ id: role.id, name: role.name, key: role.key }))}
        stations={stations.map((station) => ({ id: station.id, name: station.name }))}
        currentUserId={user.id}
      />
    </div>
  );
}
