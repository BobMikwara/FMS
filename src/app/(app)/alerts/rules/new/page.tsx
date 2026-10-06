import { hasOrganizationWideStationAccess, stationScopeForUser, userCanAccessStation } from "@/server/auth/authorization";
import { getCurrentUser } from "@/server/auth/session";
import { listAllStations, listAllTanks, listFuelTypes } from "@/server/db/repo/stations";
import { listDevices } from "@/server/db/repo/devices";
import { PageHeader } from "@/components/ui/layout";
import { RuleForm } from "./rule-form";

export const dynamic = "force-dynamic";

const RULE_TYPES = [
  { value: "low_fuel", label: "Low fuel level", severity: "warning", condition: { percent: 20 } },
  { value: "refill", label: "Confirmed refill", severity: "info", condition: { liters: 120 } },
  { value: "invalid_reading", label: "Invalid telemetry reading", severity: "warning", condition: { metric: "validation", operator: "fails" } },
  { value: "critical_fuel", label: "Critical fuel level", severity: "critical", condition: { percent: 10 } },
  { value: "high_fuel", label: "High fuel level", severity: "info", condition: { percent: 95 } },
  { value: "overfill", label: "Overfill risk", severity: "critical", condition: { percent: 98 } },
  { value: "water_detected", label: "Water detected", severity: "warning", condition: { mm: 25 } },
  { value: "high_temperature", label: "High temperature", severity: "warning", condition: { celsius: 40 } },
  { value: "probe_offline", label: "Probe offline", severity: "critical", condition: { minutes: 10 } },
  { value: "gps_offline", label: "GPS device offline", severity: "warning", condition: { minutes: 20 } },
  { value: "rapid_change", label: "Rapid level change", severity: "warning", condition: { litersPerMinute: 250 } },
  {
    value: "suspected_loss",
    label: "Suspected loss",
    severity: "warning",
    condition: { liters: 200, sensitivity: "medium" },
  },
  {
    value: "reconciliation_variance",
    label: "Reconciliation variance",
    severity: "warning",
    condition: { percent: 0.5 },
  },
];

export default async function NewRulePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const tanks = (await listAllTanks(user.organizationId))
    .filter((tank) => userCanAccessStation(user, tank.stationId))
    .filter((tank) => !tank.isArchived);
  const stations = (await listAllStations(user.organizationId))
    .filter((station) => userCanAccessStation(user, station.id))
    .filter((station) => !station.isArchived);
  const fuelTypes = (await listFuelTypes(user.organizationId, true));
  const devices = (await listDevices({ orgId: user.organizationId, pageSize: 500, stationIds: stationScopeForUser(user) })).rows;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create alert rule"
        description="Choose what to watch, where to watch it, and how the platform should react when the condition is met."
        breadcrumbs={[{ label: "Alerts", href: "/alerts" }, { label: "Alert rules", href: "/alerts/rules" }, { label: "Create rule" }]}
      />
      <RuleForm
        ruleTypes={RULE_TYPES}
        tanks={tanks.map((tank) => ({ id: tank.id, name: `${tank.name} · ${tank.code}` }))}
        stations={stations.map((station) => ({ id: station.id, name: `${station.name} (${station.code})` }))}
        fuelTypes={fuelTypes.map((fuelType) => ({ id: fuelType.id, name: fuelType.displayName }))}
        devices={devices.map((device) => ({ id: device.id, name: `${device.serialNumber}${device.label ? ` · ${device.label}` : ""}` }))}
        allowOrganizationScope={hasOrganizationWideStationAccess(user)}
      />
    </div>
  );
}
