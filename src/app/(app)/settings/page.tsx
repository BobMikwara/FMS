import { stationScopeForUser } from "@/server/auth/authorization";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Fuel, Bell, Sliders } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getOrganization } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { OrganizationSettingsForm } from "./organization-settings-form";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/settings",
    icon: Building2,
    title: "Organization",
    description: "Name, address, contact details and the working units used across the platform.",
  },
  {
    href: "/settings/fuel-types",
    icon: Fuel,
    title: "Fuel types",
    description: "The products you store - display name, colour and density used for volume conversion.",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Who receives which alerts, on which channel, and how often digests are sent.",
  },
  {
    href: "/settings/system",
    icon: Sliders,
    title: "System",
    description: "Simulator, data retention, session policy and platform diagnostics.",
  },
];

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const organization = (await getOrganization(user.organizationId));
  const visibleSections = SECTIONS.filter((section) =>
    section.href === "/settings" ||
    (section.href === "/settings/fuel-types" && hasPermission(user, "fuel_types.manage")) ||
    (["/settings/notifications", "/settings/system"].includes(section.href) && hasPermission(user, "settings.manage")),
  );
  const stationIds = stationScopeForUser(user);
  const stationCount = (await listAllStations(user.organizationId)).filter(
    (station) => stationIds === undefined || stationIds.includes(station.id),
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Configuration for this workspace. Changes take effect immediately and are written to the audit log."
        breadcrumbs={[{ label: "Settings" }]}
      />

      <nav aria-label="Settings sections" className="grid gap-3 sm:grid-cols-2">
        {visibleSections.map((section) => {
          const Icon = section.icon;
          const active = section.href === "/settings";
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className="card flex items-start gap-3 p-4 transition-colors hover:border-[var(--line-strong)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--surface-3)] text-[var(--ink-2)]">
                <Icon size={16} />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[0.875rem] font-semibold text-[var(--ink)]">
                  {section.title}
                  {active ? <span className="badge badge-ok text-[0.625rem]">current</span> : null}
                </span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{section.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      {organization ? (
        <OrganizationSettingsForm
          organization={{
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            currency: organization.currency,
            units: organization.units,
            tempUnit: organization.tempUnit,
            timezone: organization.timezone,
            locale: organization.locale,
            plan: organization.plan,
            stationCount,
          }}
          canManage={hasPermission(user, "organizations.manage")}
        />
      ) : null}
    </div>
  );
}
