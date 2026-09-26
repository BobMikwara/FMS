import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listRoles, listUsers } from "@/server/db/repo/core";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { Users, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const roles = listRoles();
  const users = listUsers(user.organizationId);

  const grouped = new Map<string, string[]>();
  for (const role of roles) {
    const permissions = Array.isArray(role.permissions) ? role.permissions : [];
    grouped.set(role.id, permissions);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Roles & permissions"
        description="Every role, the permissions it grants, and how many people currently hold it. Permissions are checked by the API on every request, so hiding a button is never the control."
        breadcrumbs={[{ label: "Administration" }, { label: "Roles & permissions" }]}
        actions={
          <Link href="/admin/users" className="btn btn-secondary btn-sm">
            <Users size={14} />
            Manage users
          </Link>
        }
      />

      <Notice tone="info" title="Roles are fixed by design">
        The five roles below cover the operating model in the product requirements: Owner, Manager, Station Manager,
        Supervisor and Finance, plus Viewer and a platform-level Super Admin. Permissions cannot be widened from the
        interface, which keeps the audit trail meaningful.
      </Notice>

      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const permissions = grouped.get(role.id) ?? [];
          const holders = users.filter((entry) => entry.roleId === role.id).length;
          const isOwner = role.key === "super_admin" || role.key === "owner";
          return (
            <section key={role.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-2)]">
                    <ShieldCheck size={16} />
                  </span>
                  <div>
                    <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">{role.name}</h2>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
                      {role.description ?? "No description provided."}
                    </p>
                  </div>
                </div>
                <Badge tone={isOwner ? "info" : "neutral"}>{holders} user{holders === 1 ? "" : "s"}</Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {permissions.length === 0 ? (
                  <span className="text-[0.75rem] text-[var(--ink-3)]">No permissions assigned.</span>
                ) : (
                  permissions.map((permission) => (
                    <code
                      key={permission}
                      className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[0.6875rem] text-[var(--ink-2)]"
                    >
                      {permission}
                    </code>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
