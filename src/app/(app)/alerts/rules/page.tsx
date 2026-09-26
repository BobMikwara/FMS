import { getCurrentUser } from "@/server/auth/session";
import { listAlertRules } from "@/server/db/repo/alerts";
import { listAllStations, listAllTanks } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { RulesBrowser } from "./rules-browser";

export const dynamic = "force-dynamic";

export default async function AlertRulesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const rules = listAlertRules(user.organizationId);
  const tanks = listAllTanks(user.organizationId);
  const stations = listAllStations(user.organizationId);
  const tankName = new Map(tanks.map((tank) => [tank.id, tank.name]));
  const stationName = new Map(stations.map((station) => [station.id, station.name]));

  const rows = rules.map((rule) => ({
    ...rule,
    tankName: rule.tankId ? (tankName.get(rule.tankId) ?? null) : null,
    stationName: rule.stationId ? (stationName.get(rule.stationId) ?? null) : null,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alert rules"
        description="Thresholds decide when an alert is raised. Rules can be scoped to a single tank, a whole station, a device or the entire organization."
        actions={
          <a href="/alerts/rules/new" className="btn btn-primary btn-sm">
            Create rule
          </a>
        }
      />
      <RulesBrowser initialRows={rows} />
    </div>
  );
}
