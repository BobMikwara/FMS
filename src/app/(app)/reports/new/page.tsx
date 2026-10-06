import { userCanAccessStation } from "@/server/auth/authorization";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listAllStations, listFuelTypes } from "@/server/db/repo/stations";
import { getOrganization } from "@/server/db/repo/core";
import { PageHeader, Notice } from "@/components/ui/layout";
import { dayStartInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

export default async function NewReportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [allStations, fuelTypes, organization] = await Promise.all([
    listAllStations(user.organizationId),
    listFuelTypes(user.organizationId),
    getOrganization(user.organizationId),
  ]);
  const stations = allStations.filter((station) => userCanAccessStation(user, station.id));
  const organizationTimeZone = normalizeTimeZone(organization?.timezone);
  const now = new Date();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Generate report"
        description="Pick a period and a category. The dataset is built from live data and downloaded as PDF, Excel or CSV."
        breadcrumbs={[
          ...(hasPermission(user, "reports.view") ? [{ label: "Reports", href: "/reports" }] : []),
          { label: "Generate" },
        ]}
        actions={hasPermission(user, "reports.view") ? (
          <Link href="/reports" className="btn btn-secondary btn-sm">
            Back to reports
          </Link>
        ) : undefined}
      />

      <Notice tone="info" title="Consumption is measured, not sold">
        Outflow is labelled “Fuel Consumption / Tank Outflow” until dispenser integration exists. Numbers come from probe
        readings, so they describe what left the tank - not what a pump rang up.
      </Notice>

      <ReportForm
        defaultFrom={dayStartInTimeZone(now, -7, organizationTimeZone).toISOString()}
        defaultTo={now.toISOString()}
        organizationTimeZone={organizationTimeZone}
        stations={stations.map((station) => ({ id: station.id, name: station.name, timeZone: station.timezone }))}
        fuelTypes={fuelTypes.map((fuel) => ({ id: fuel.id, name: fuel.displayName }))}
        canExport={hasPermission(user, "reports.export")}
        canViewReports={hasPermission(user, "reports.view")}
      />
    </div>
  );
}
