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

  const roles = (await listRoles());
  const stations = (await listAllStations(user.organizationId));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invite user"
        description="Create an account for a colleague. They can sign in immediately with the temporary password you set."
        breadcrumbs={[{ label: "Users", href: "/admin/users" }, { label: "Invite user" }]}
        actions={
          <Link href="/admin/users" className="btn btn-secondary btn-sm">
            Back to users
          </Link>
        }
      />

      <Notice tone="info" title="Pick a temporary password">
        Use at least 10 characters and ask the person to change it after their first sign-in. Passwords are stored hashed,
        never in plain text, and are never shown again once the account exists.
      </Notice>

      <InviteUserForm
        roles={roles.map((role) => ({ id: role.id, name: role.name, key: role.key }))}
        stations={stations.map((station) => ({ id: station.id, name: station.name }))}
      />
    </div>
  );
}
