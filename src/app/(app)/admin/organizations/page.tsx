import { redirect } from "next/navigation";
import { Building2, MapPin } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { listOrganizations } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/layout";
import { Badge } from "@/components/ui/feedback";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const organizations = (await listOrganizations());

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organizations"
        description="Each tenant is fully isolated: stations, tanks, devices, users and readings never cross the boundary."
        breadcrumbs={[{ label: "Administration" }, { label: "Organizations" }]}
      />

      <Notice tone="info" title="Platform view">
        You are signed in as {user.name} in the {user.organizationId} workspace. Organization records are created by the
        platform operator when a customer onboards.
      </Notice>

      <div className="grid gap-4 lg:grid-cols-2">
        {organizations.map(async (org) => {
          const stations = (await listAllStations(org.id));
          const isCurrent = org.id === user.organizationId;
          return (
            <section key={org.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-2)]">
                    <Building2 size={16} />
                  </span>
                  <div>
                    <h2 className="text-[0.9375rem] font-semibold tracking-tight text-[var(--ink)]">{org.name}</h2>
                    <p className="mt-1 text-[0.75rem] text-[var(--ink-3)]">
                      {org.slug} · created {timeAgo(org.createdAt)}
                    </p>
                  </div>
                </div>
                {isCurrent ? <Badge tone="info">Your workspace</Badge> : null}
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Stations</dt>
                  <dd className="text-num mt-1 text-[1.125rem] font-semibold text-[var(--ink)]">{stations.length}</dd>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Plan</dt>
                  <dd className="mt-1 text-[0.875rem] font-medium text-[var(--ink)]">{org.plan ?? "Standard"}</dd>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <dt className="text-[0.6875rem] uppercase tracking-wide text-[var(--ink-3)]">Status</dt>
                  <dd className="mt-1">
                    <Badge tone={org.isActive ? "ok" : "warn"}>{org.isActive ? "active" : "suspended"}</Badge>
                  </dd>
                </div>
              </dl>

              {stations.length > 0 ? (
                <div className="mt-4 space-y-1.5">
                  <p className="text-[0.75rem] font-medium text-[var(--ink-2)]">Stations</p>
                  <ul className="space-y-1">
                    {stations.slice(0, 4).map((station) => (
                      <li key={station.id} className="flex items-center gap-2 text-[0.8125rem] text-[var(--ink-2)]">
                        <MapPin size={13} className="shrink-0 text-[var(--ink-3)]" />
                        <span className="truncate">{station.name}</span>
                        <span className="text-num ml-auto shrink-0 text-[0.75rem] text-[var(--ink-3)]">
                          {station.city ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {stations.length > 4 ? (
                    <p className="text-[0.75rem] text-[var(--ink-3)]">+{stations.length - 4} more</p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-[0.8125rem] text-[var(--ink-3)]">No stations yet.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
