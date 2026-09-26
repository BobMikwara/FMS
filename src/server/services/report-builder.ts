/**
 * Report builder.
 *
 * Turns a stored report definition into a real tabular dataset. The same rows
 * back the on-screen preview, the CSV download and the Excel download, so a
 * number on screen can never disagree with the number in the file.
 *
 * Every value comes from the same read models the rest of the application uses
 * — nothing is estimated or invented for the sake of filling a column. When a
 * value genuinely does not exist (no probe reading yet, no device attached) the
 * cell reads "Not available" rather than a plausible-looking number.
 */

import { listAllStations, listAllTanks, listFuelTypes } from "@/server/db/repo/stations";
import { listEvents } from "@/server/db/repo/events";
import { listAlerts } from "@/server/db/repo/alerts";
import { listAllVehicles, listAllDevices } from "@/server/db/repo/devices";
import { listAuditLogs, listUsers } from "@/server/db/repo/core";
import { buildDashboard, buildStationDetail } from "@/server/services/analytics";
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
  return !allowedStationIds || allowedStationIds.length === 0 || !selectedStationId || allowedStationIds.includes(selectedStationId);
}

function reportStationScope(report: Report, allowedStationIds?: string[]): string[] | undefined {
  const selectedStationId = reportStationId(report);
  if (selectedStationId) return [selectedStationId];
  return allowedStationIds && allowedStationIds.length > 0 ? allowedStationIds : undefined;
}

async function movementRows(
  orgId: string,
  from: string,
  to: string,
  type?: string,
  stationIds?: string[],
): Promise<ReportTable> {
  const result = (await listEvents({ orgId, type, from, to, pageSize: 5000, stationIds }));
  if (result.rows.length === 0) {
    return empty("No movements were recorded in this period.");
  }

  const stationName = new Map((await listAllStations(orgId)).filter((station) => !stationIds || stationIds.includes(station.id)).map((station) => [station.id, station.name]));
  const tankName = new Map((await listAllTanks(orgId)).filter((tank) => !stationIds || stationIds.includes(tank.stationId)).map((tank) => [tank.id, tank.name]));
  const fuelLabel = new Map((await listFuelTypes(orgId)).map((fuel) => [fuel.id, fuel.displayName]));
  const deviceSerial = new Map((await listAllDevices(orgId)).map((device) => [device.id, device.serialNumber]));
  const tankFuel = new Map((await listAllTanks(orgId)).filter((tank) => !stationIds || stationIds.includes(tank.stationId)).map((tank) => [tank.id, tank.fuelTypeId]));

  return {
    headers: [
      "Timestamp (UTC)",
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
    rows: result.rows.map((event) => [
      event.ts,
      stationName.get(event.stationId) ?? "—",
      tankName.get(event.tankId) ?? "—",
      fuelLabel.get(tankFuel.get(event.tankId) ?? "") ?? "—",
      event.type,
      nf(Math.abs(event.volume)),
      nf(event.levelBefore),
      nf(event.levelAfter),
      event.confidence,
      event.deviceId ? deviceSerial.get(event.deviceId) ?? "—" : "—",
      event.reason ?? "—",
    ]),
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

  switch (report.category) {
    case "consumption":
      return (await movementRows(orgId, from, to, "consumption", stationIds));

    case "refills":
      return (await movementRows(orgId, from, to, "refill", stationIds));

    case "movements":
    case "ledger":
      return (await movementRows(orgId, from, to, undefined, stationIds));

    case "inventory": {
      const tanks = (await listAllTanks(orgId)).filter((tank) => !stationIds || stationIds.includes(tank.stationId));
      if (tanks.length === 0) return empty("No tanks have been added yet.");
      const stationName = new Map((await listAllStations(orgId)).filter((station) => !stationIds || stationIds.includes(station.id)).map((station) => [station.id, station.name]));
      const fuelLabel = new Map((await listFuelTypes(orgId)).map((fuel) => [fuel.id, fuel.displayName]));
      return {
        headers: ["Station", "Tank", "Fuel type", "Capacity (L)", "Volume (L)", "Level (%)", "Last reading (UTC)"],
        rows: tanks.map((tank) => [
          stationName.get(tank.stationId) ?? "—",
          tank.name,
          fuelLabel.get(tank.fuelTypeId) ?? "—",
          nf(tank.capacity),
          nf(tank.currentVolume),
          nf((tank.currentVolume / tank.capacity) * 100, 1),
          tank.lastValidReadingAt ?? tank.lastReadingAt ?? NOT_AVAILABLE,
        ]),
      };
    }

    case "reconciliation": {
      const tanks = (await listAllTanks(orgId)).filter((tank) => !stationIds || stationIds.includes(tank.stationId));
      if (tanks.length === 0) return empty("No tanks have been added yet.");
      const stationName = new Map((await listAllStations(orgId)).filter((station) => !stationIds || stationIds.includes(station.id)).map((station) => [station.id, station.name]));
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
          const reconciliation = (await reconcileTank(tank.id, from, to));
          const coverage = (await stockCoverage(tank.id, 7));
          return [
            stationName.get(tank.stationId) ?? "—",
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
      const result = (await listAlerts({ orgId, from, to, pageSize: 5000, stationIds }));
      if (result.rows.length === 0) return empty("No alerts were raised in this period.");
      const stationName = new Map((await listAllStations(orgId)).filter((station) => !stationIds || stationIds.includes(station.id)).map((station) => [station.id, station.name]));
      const tankName = new Map((await listAllTanks(orgId)).filter((tank) => !stationIds || stationIds.includes(tank.stationId)).map((tank) => [tank.id, tank.name]));
      return {
        headers: [
          "Raised (UTC)",
          "Station",
          "Tank",
          "Type",
          "Severity",
          "Status",
          "Title",
          "Message",
          "Acknowledged (UTC)",
          "Resolved (UTC)",
          "Resolution note",
        ],
        rows: result.rows.map((alert) => [
          alert.createdAt,
          stationName.get(alert.stationId) ?? "—",
          alert.tankId ? tankName.get(alert.tankId) ?? "—" : "—",
          alert.type,
          alert.severity,
          alert.status,
          alert.title,
          alert.message,
          alert.acknowledgedAt ?? "—",
          alert.resolvedAt ?? "—",
          alert.resolutionNote ?? "—",
        ]),
      };
    }

    case "vehicles": {
      const vehicles = (await listAllVehicles(orgId)).filter((vehicle) => !stationIds || (vehicle.stationId != null && stationIds.includes(vehicle.stationId)));
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
          deviceSerial.get(vehicle.id) ?? "—",
          vehicle.driverName ?? "—",
          vehicle.driverPhone ?? "—",
          vehicle.isArchived ? "Archived" : vehicle.status,
          nf(vehicle.odometerKm),
        ]),
      };
    }

    case "audit": {
      const users = stationIds
        ? (await listUsers(orgId)).filter((user) => user.stationIds.length === 0 || user.stationIds.some((stationId) => stationIds.includes(stationId)))
        : [];
      const logs = (await listAuditLogs({
        orgId,
        from,
        to,
        pageSize: 5000,
        userIds: stationIds ? users.map((user) => user.id) : undefined,
      })).rows;
      if (logs.length === 0) return empty("No audit entries in this period.");
      return {
        headers: ["Timestamp (UTC)", "User", "Action", "Record", "Record type", "Detail", "IP address"],
        rows: logs.map((log) => [
          log.ts,
          log.userLabel,
          log.action,
          log.entityLabel ?? log.entityId ?? "—",
          log.entity,
          log.summary,
          log.ip ?? "—",
        ]),
      };
    }

    case "stations": {
      const stations = (await listAllStations(orgId)).filter((station) => !stationIds || stationIds.includes(station.id));
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
          "Consumption (L)",
          "Refills (L)",
          "Status",
        ],
        rows: await Promise.all(stations.map(async (station) => {
          const detail = (await buildStationDetail(station.id, "7d"));
          return [
            station.name,
            station.city,
            station.region,
            detail ? nf(detail.tanks.length) : "0",
            detail ? nf(detail.totalFuel) : NOT_AVAILABLE,
            detail ? nf(detail.capacity) : NOT_AVAILABLE,
            detail ? nf(detail.utilizationPct, 1) : NOT_AVAILABLE,
            detail ? nf(detail.todayConsumption) : NOT_AVAILABLE,
            detail ? nf(detail.todayRefills) : NOT_AVAILABLE,
            station.status,
          ];
        })),
      };
    }

    case "summary":
    default: {
      const dashboard = (await buildDashboard(orgId, "7d", stationIds));
      const k = dashboard.kpis;
      return {
        headers: ["Metric", "Value", "Unit / note"],
        rows: [
          ["Organization", dashboard.orgName, ""],
          ["Report period", `${from} to ${to}`, "UTC"],
          ["Total stations", nf(k.totalStations), `${k.onlineStations} online · ${k.offlineStations} offline`],
          ["Total tanks", nf(k.totalTanks), `${k.lowFuelTanks} low · ${k.criticalFuelTanks} critical`],
          ["Fuel on hand", nf(k.totalFuel), "L"],
          ["Total capacity", nf(k.totalCapacity), "L"],
          ["Average level", nf(k.averageLevelPct, 1), "%"],
          ["Fuel consumption / tank outflow", nf(k.todayConsumption), "L today"],
          ["Refills", nf(k.todayRefills), `L today · ${k.refillCount} events`],
          ["Active alerts", nf(k.activeAlerts), `${k.criticalAlerts} critical · ${k.warningAlerts} warning`],
          ["Suspected loss", nf(k.suspectedLoss), "L — investigation required, not proof of theft"],
          ["Devices", nf(k.totalDevices), `${k.connectedDevices} online · ${k.offlineDevices} offline`],
          ["Vehicles", nf(k.vehicles), "tracked"],
        ],
      };
    }
  }
}

export { REPORT_CATEGORIES, reportCategoryLabel } from "@/lib/report-categories";
