/**
 * Report builder.
 *
 * Turns a stored report definition into a real tabular dataset. The same rows
 * back the on-screen preview, the CSV download and the Excel download, so a
 * number on screen can never disagree with the number in the file.
 *
 * Every value comes from the same read models the rest of the application uses
 * - nothing is estimated or invented for the sake of filling a column. When a
 * value genuinely does not exist (no probe reading yet, no device attached) the
 * cell reads "Not available" rather than a plausible-looking number.
 */

import { listAllStations, listAllTanks, listFuelTypes, getStation } from "@/server/db/repo/stations";
import { listEvents, movementTotals } from "@/server/db/repo/events";
import { listAlerts } from "@/server/db/repo/alerts";
import { listAllVehicles, listAllDevices } from "@/server/db/repo/devices";
import { getOrganization, getSettings, listAuditLogs } from "@/server/db/repo/core";
import { buildDashboard } from "@/server/services/analytics";
import { formatDateTimeInTimeZone, normalizeTimeZone } from "@/server/services/time-zone";
import { resolveOperatorSettings } from "@/server/domain/system-config";
import { reconcileTank, stockCoverage } from "@/server/engine/fuel";
import type { Report } from "@/server/domain/types";

export interface ReportTable {
  headers: string[];
  rows: unknown[][];
}

export const NOT_AVAILABLE = "Not available";

function nf(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function empty(message: string): ReportTable {
  return { headers: ["Status"], rows: [[message]] };
}

/* -------------------------------------------------------------------------- */
/* Movement ledger                                                            */
/* -------------------------------------------------------------------------- */

export function reportStationId(report: Report): string | null {
  const stationId = report.filters.stationId;
  return typeof stationId === "string" && stationId.length > 0 ? stationId : null;
}

export function reportStationIsAllowed(report: Report, allowedStationIds?: string[]): boolean {
  const selectedStationId = reportStationId(report);
  return allowedStationIds === undefined || (selectedStationId !== null && allowedStationIds.includes(selectedStationId));
}

function reportStationScope(report: Report, allowedStationIds?: string[]): string[] | undefined {
  const selectedStationId = reportStationId(report);
  if (selectedStationId) return [selectedStationId];
  return allowedStationIds;
}

export async function resolveReportTimeZone(report: Report): Promise<string> {
  const storedTimeZone = report.filters.timeZone;
  if (typeof storedTimeZone === "string" && storedTimeZone.trim()) {
    return normalizeTimeZone(storedTimeZone);
  }
  const stationId = reportStationId(report);
  const [organization, station] = await Promise.all([
    getOrganization(report.organizationId),
    stationId ? getStation(stationId) : Promise.resolve(null),
  ]);
  return normalizeTimeZone(station?.timezone ?? organization?.timezone);
}

async function movementRows(
  orgId: string,
  from: string,
  to: string,
  type: string | undefined,
  stationIds: string[] | undefined,
  fallbackTimeZone: string,
): Promise<ReportTable> {
  const [result, stations, allTanks, fuelTypes, devices] = await Promise.all([
    listEvents({ orgId, type, from, to, pageSize: 5000, stationIds }),
    listAllStations(orgId),
    listAllTanks(orgId),
    listFuelTypes(orgId),
    listAllDevices(orgId),
  ]);
  if (result.rows.length === 0) {
    return empty("No movements were recorded in this period.");
  }

  const stationById = new Map(stations.map((station) => [station.id, station]));
  const tanks = allTanks.filter((tank) => !stationIds || stationIds.includes(tank.stationId));
  const tankById = new Map(tanks.map((tank) => [tank.id, tank]));
  const fuelLabel = new Map(fuelTypes.map((fuel) => [fuel.id, fuel.displayName]));
  const deviceSerial = new Map(devices.map((device) => [device.id, device.serialNumber]));

  return {
    headers: [
      "Timestamp (station local time)",
      "Time zone",
      "Station",
      "Tank",
      "Fuel type",
      "Event",
      "Volume (L)",
      "Level before (L)",
      "Level after (L)",
      "Confidence",
      "Device",
      "Reason",
    ],
    rows: result.rows.map((event) => {
      const station = stationById.get(event.stationId);
      const timeZone = normalizeTimeZone(station?.timezone, fallbackTimeZone);
      const tank = tankById.get(event.tankId);
      return [
        formatDateTimeInTimeZone(event.ts, timeZone),
        timeZone,
        station?.name ?? "-",
        tank?.name ?? "-",
        fuelLabel.get(tank?.fuelTypeId ?? "") ?? "-",
        event.type,
        nf(Math.abs(event.volume)),
        nf(event.levelBefore),
        nf(event.levelAfter),
        event.confidence,
        event.deviceId ? deviceSerial.get(event.deviceId) ?? "-" : "-",
        event.reason ?? "-",
      ];
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Main dispatcher                                                            */
/* -------------------------------------------------------------------------- */

export async function buildReportTable(report: Report, allowedStationIds?: string[]): Promise<ReportTable> {
  const orgId = report.organizationId;
  const from = report.dateFrom;
  const to = report.dateTo;
  if (!reportStationIsAllowed(report, allowedStationIds)) {
    throw new Error("Report station is outside the current user's station scope.");
  }
  const stationIds = reportStationScope(report, allowedStationIds);
  const timeZone = await resolveReportTimeZone(report);

  switch (report.category) {
    case "consumption":
      return (await movementRows(orgId, from, to, "consumption", stationIds, timeZone));

    case "refills":
      return (await movementRows(orgId, from, to, "refill", stationIds, timeZone));

    case "movements":
    case "ledger":
      return (await movementRows(orgId, from, to, undefined, stationIds, timeZone));

    case "inventory": {
      const [allTanks, stations, fuelTypes] = await Promise.all([
        listAllTanks(orgId),
        listAllStations(orgId),
        listFuelTypes(orgId),
      ]);
      const tanks = allTanks.filter((tank) => !stationIds || stationIds.includes(tank.stationId));
      if (tanks.length === 0) return empty("No tanks have been added yet.");
      const stationById = new Map(stations.map((station) => [station.id, station]));
      const fuelLabel = new Map(fuelTypes.map((fuel) => [fuel.id, fuel.displayName]));
      return {
        headers: ["Station", "Tank", "Fuel type", "Capacity (L)", "Volume (L)", "Level (%)", "Last reading (station local time)", "Time zone"],
        rows: tanks.map((tank) => {
          const station = stationById.get(tank.stationId);
          const stationTimeZone = normalizeTimeZone(station?.timezone, timeZone);
          const lastReading = tank.lastValidReadingAt ?? tank.lastReadingAt;
          return [
            station?.name ?? "-",
            tank.name,
            fuelLabel.get(tank.fuelTypeId) ?? "-",
            nf(tank.capacity),
            nf(tank.currentVolume),
            nf((tank.currentVolume / tank.capacity) * 100, 1),
            lastReading ? formatDateTimeInTimeZone(lastReading, stationTimeZone) : NOT_AVAILABLE,
            stationTimeZone,
          ];
        }),
      };
    }

    case "reconciliation": {
      const [allTanks, stations, storedSettings] = await Promise.all([
        listAllTanks(orgId),
        listAllStations(orgId),
        getSettings(orgId),
      ]);
      const tanks = allTanks.filter((tank) => !stationIds || stationIds.includes(tank.stationId));
      if (tanks.length === 0) return empty("No tanks have been added yet.");
      const stationById = new Map(stations.map((station) => [station.id, station]));
      const operatorSettings = resolveOperatorSettings(storedSettings);
      return {
        headers: [
          "Station",
          "Tank",
          "Opening stock (L)",
          "Refills (L)",
          "Consumption (L)",
          "Expected closing (L)",
          "Measured closing (L)",
          "Variance (L)",
          "Variance (%)",
          "Avg daily consumption (L)",
          "Estimated days remaining",
        ],
        rows: await Promise.all(tanks.map(async (tank) => {
          const station = stationById.get(tank.stationId);
          const stationTimeZone = normalizeTimeZone(station?.timezone, timeZone);
          const [reconciliation, coverage] = await Promise.all([
            reconcileTank(tank.id, from, to, operatorSettings.reconciliationVariancePct),
            stockCoverage(tank.id, 7, stationTimeZone),
          ]);
          return [
            station?.name ?? "-",
            tank.name,
            nf(reconciliation.openingStock),
            nf(reconciliation.refills),
            nf(reconciliation.consumption),
            nf(reconciliation.expectedClosing),
            nf(reconciliation.measured),
            nf(reconciliation.variance),
            nf(reconciliation.variancePct, 2),
            nf(coverage.avgDailyConsumption),
            coverage.daysRemaining == null ? NOT_AVAILABLE : nf(coverage.daysRemaining, 1),
          ];
        })),
      };
    }

    case "alerts": {
      const [result, stations, allTanks] = await Promise.all([
        listAlerts({ orgId, from, to, pageSize: 5000, stationIds }),
        listAllStations(orgId),
        listAllTanks(orgId),
      ]);
      if (result.rows.length === 0) return empty("No alerts were raised in this period.");
      const stationById = new Map(stations.map((station) => [station.id, station]));
      const tankById = new Map(allTanks.map((tank) => [tank.id, tank]));
      return {
        headers: [
          "Raised (station local time)",
          "Time zone",
          "Station",
          "Tank",
          "Type",
          "Severity",
          "Status",
          "Title",
          "Message",
          "Acknowledged (station local time)",
          "Resolved (station local time)",
          "Resolution note",
        ],
        rows: result.rows.map((alert) => {
          const station = stationById.get(alert.stationId);
          const stationTimeZone = normalizeTimeZone(station?.timezone, timeZone);
          return [
            formatDateTimeInTimeZone(alert.createdAt, stationTimeZone),
            stationTimeZone,
            station?.name ?? "-",
            alert.tankId ? tankById.get(alert.tankId)?.name ?? "-" : "-",
            alert.type,
            alert.severity,
            alert.status,
            alert.title,
            alert.message,
            alert.acknowledgedAt ? formatDateTimeInTimeZone(alert.acknowledgedAt, stationTimeZone) : "-",
            alert.resolvedAt ? formatDateTimeInTimeZone(alert.resolvedAt, stationTimeZone) : "-",
            alert.resolutionNote ?? "-",
          ];
        }),
      };
    }

    case "vehicles": {
      const vehicles = (await listAllVehicles(orgId, true)).filter((vehicle) => !stationIds || (vehicle.stationId != null && stationIds.includes(vehicle.stationId)));
      if (vehicles.length === 0) return empty("No vehicles have been added yet.");
      const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
      const deviceSerial = new Map(
        (await listAllDevices(orgId))
          .filter((device) => device.vehicleId && vehicleIds.has(device.vehicleId))
          .map((device) => [device.vehicleId as string, device.serialNumber]),
      );
      return {
        headers: ["Plate", "Vehicle", "Type", "Tracker device", "Driver", "Driver phone", "Status", "Odometer (km)"],
        rows: vehicles.map((vehicle) => [
          vehicle.plateNumber,
          vehicle.name,
          vehicle.type,
          deviceSerial.get(vehicle.id) ?? "-",
          vehicle.driverName ?? "-",
          vehicle.driverPhone ?? "-",
          vehicle.isArchived ? "Archived" : vehicle.status,
          nf(vehicle.odometerKm),
        ]),
      };
    }

    case "audit": {
      const logs = (await listAuditLogs({
        orgId,
        from,
        to,
        pageSize: 5000,
        stationIds,
      })).rows;
      if (logs.length === 0) return empty("No audit entries in this period.");
      return {
        headers: ["Timestamp (organization local time)", "Time zone", "User", "Action", "Record", "Record type", "Detail", "IP address"],
        rows: logs.map((log) => [
          formatDateTimeInTimeZone(log.ts, timeZone),
          timeZone,
          log.userLabel,
          log.action,
          log.entityLabel ?? log.entityId ?? "-",
          log.entity,
          log.summary,
          log.ip ?? "-",
        ]),
      };
    }

    case "stations": {
      const dashboard = await buildDashboard(orgId, "7d", stationIds, timeZone);
      const stations = dashboard.stations;
      if (stations.length === 0) return empty("No stations have been added yet.");
      return {
        headers: [
          "Station",
          "City",
          "Region",
          "Tanks",
          "Fuel on hand (L)",
          "Capacity (L)",
          "Utilisation (%)",
          "Consumption today (L)",
          "Refills today (L)",
          "Status",
        ],
        rows: stations.map((summary) => [
          summary.station.name,
          summary.station.city,
          summary.station.region,
          nf(summary.tankCount),
          nf(summary.totalFuel),
          nf(summary.capacity),
          nf(summary.utilizationPct, 1),
          nf(summary.todayConsumption),
          nf(summary.todayRefills),
          summary.status,
        ]),
      };
    }

    case "summary":
    default: {
      const [dashboard, periodTotals] = await Promise.all([
        buildDashboard(orgId, "7d", stationIds, timeZone),
        movementTotals(orgId, from, to, undefined, undefined, stationIds),
      ]);
      const k = dashboard.kpis;
      return {
        headers: ["Metric", "Value", "Unit / note"],
        rows: [
          ["Organization", dashboard.orgName, ""],
          ["Report period", `${formatDateTimeInTimeZone(from, timeZone)} to ${formatDateTimeInTimeZone(to, timeZone)}`, timeZone],
          ["Snapshot basis", "Current inventory and status", "Activity totals below use the selected report period"],
          ["Total stations", nf(k.totalStations), `${k.onlineStations} online · ${k.offlineStations} offline`],
          ["Total tanks", nf(k.totalTanks), `${k.lowFuelTanks} low · ${k.criticalFuelTanks} critical`],
          ["Fuel on hand", nf(k.totalFuel), "L at export time; live data"],
          ["Total capacity", nf(k.totalCapacity), "L"],
          ["Average level", nf(k.averageLevelPct, 1), "%"],
          ["Fuel consumption / tank outflow", nf(periodTotals.consumption), `${periodTotals.consumptionCount} events for selected period`],
          ["Refills", nf(periodTotals.refills), `${periodTotals.refillCount} events for selected period`],
          ["Active alerts", nf(k.activeAlerts), `${k.criticalAlerts} critical · ${k.warningAlerts} warning at export time`],
          ["Suspected loss", nf(periodTotals.suspectedLoss), "L for selected period; investigate, not proof of theft"],
          ["Devices", nf(k.totalDevices), `${k.connectedDevices} online · ${k.offlineDevices} offline`],
          ["Vehicles", nf(k.vehicles), "tracked"],
        ],
      };
    }
  }
}

export { REPORT_CATEGORIES, reportCategoryLabel } from "@/lib/report-categories";
