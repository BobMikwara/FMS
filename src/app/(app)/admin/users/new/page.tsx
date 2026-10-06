import { hasOrganizationWideStationAccess, isPlatformOwner, userCanAccessStation } from "@/server/auth/authorization";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listRoles } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { PageHeader, Notice } from "@/components/ui/layout";
import { InviteUserForm } from "./invite-user-form";

export const dynamic = "force-dynamic";

export default async function InviteUserPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const roles = (await listRoles()).filter((role) =>
    hasOrganizationWideStationAccess(user) || (role.key !== "admin" && !isPlatformOwner(role.key)),
  );
  const stations = (await listAllStations(user.organizationId)).filter((station) => userCanAccessStation(user, station.id));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invite user"
        description="Send a one-time account activation link. The user sets their own password before the account becomes active."
        breadcrumbs={[{ label: "Users", href: "/admin/users" }, { label: "Invite user" }]}
        actions={
          <Link href="/admin/users" className="btn btn-secondary btn-sm">
            Back to users
          </Link>
        }
      />

      <Notice tone="info" title="Activation requires email delivery">
        The account stays invited until the recipient follows a one-time link and sets a password. Configure SMTP and AUTH_URL
        for invitation delivery; no temporary password is displayed or sent.
      </Notice>

      <InviteUserForm
        roles={roles.map((role) => ({ id: role.id, name: role.name, key: role.key }))}
        stations={stations.map((station) => ({ id: station.id, name: station.name }))}
      />
    </div>
  );
}
