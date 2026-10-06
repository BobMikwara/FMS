import { hasOrganizationWideStationAccess, stationScopeForUser } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/session";
import type { Station } from "@/server/domain/types";
import { createStation, listStations } from "@/server/db/repo/stations";
import { buildStationDetail } from "@/server/services/analytics";
import { ApiError, audit, jsonCreated, jsonError, jsonOk, maxLen, num, optionalNum, parseJsonBody, parsePagination, required, str, withAnyPermission, withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("stations.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 24);
    const result = (await listStations({
      orgId: ctx.user.organizationId,
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      region: params.get("region") ?? undefined,
      city: params.get("city") ?? undefined,
      sort: params.get("sort") ?? "name",
      order: (params.get("order") as "asc" | "desc") ?? "asc",
      page,
      pageSize,
      includeArchived: params.get("archived") === "true",
      archivedOnly: params.get("archived") === "true",
      stationIds: stationScopeForUser(ctx.user),
    }));
    const canViewTanks = hasPermission(ctx.user, "tanks.view");
    const canViewMovements = hasPermission(ctx.user, "movements.view");
    const canViewAlerts = hasPermission(ctx.user, "alerts.view");
    const canViewDevices = hasPermission(ctx.user, "devices.view");
    const rows = await Promise.all(result.rows.map(async (station) => {
      try {
        const detail = (await buildStationDetail(station.id, "today"));
        const summary = detail
          ? {
              tankCount: canViewTanks ? detail.tanks.length : null,
              totalFuel: canViewTanks ? Math.round(detail.totalFuel) : null,
              capacity: canViewTanks ? Math.round(detail.capacity) : null,
              utilizationPct: canViewTanks ? Number(detail.utilizationPct.toFixed(1)) : null,
              todayConsumption: canViewMovements ? detail.todayConsumption : null,
              todayRefills: canViewMovements ? detail.todayRefills : null,
              activeAlerts: canViewAlerts ? detail.alerts.filter((alert) => alert.status === "active").length : null,
              offlineDevices: canViewDevices ? detail.devices.filter((device) => device.status === "offline").length : null,
              totalDevices: canViewDevices ? detail.devices.length : null,
            }
          : {
              tankCount: null,
              totalFuel: null,
              capacity: null,
              utilizationPct: null,
              todayConsumption: null,
              todayRefills: null,
              activeAlerts: null,
              offlineDevices: null,
              totalDevices: null,
            };
        return { ...station, ...summary, summary: detail ? summary : null };
      } catch {
        return {
          ...station,
          tankCount: null,
          totalFuel: null,
          capacity: null,
          utilizationPct: null,
          todayConsumption: null,
          todayRefills: null,
          activeAlerts: null,
          offlineDevices: null,
          totalDevices: null,
          summary: null,
        };
      }
    }));
    return jsonOk({ rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("stations.create", async (request, ctx) => {
  try {
    if (!hasOrganizationWideStationAccess(ctx.user)) {
      throw new ApiError(403, "Only organization-wide administrators can create stations.", "forbidden");
    }
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const name = maxLen(required(body.name, "Station name"), 120, "Station name");
    const code = maxLen(required(body.code, "Station code"), 32, "Station code");
    const latitude = num(body.latitude, Number.NaN);
    const longitude = num(body.longitude, Number.NaN);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new ApiError(422, "Latitude and longitude are required and must be valid coordinates.", "validation_error");
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new ApiError(422, "Coordinates are outside the valid range.", "validation_error");
    }
  let station!: Station;
  try {
      station = (await createStation({
        organizationId: ctx.user.organizationId,
        name,
        code: code.toUpperCase(),
        address: str(body.address),
        city: str(body.city),
        region: str(body.region),
        country: str(body.country, "Tanzania"),
        phone: str(body.phone) || null,
        email: str(body.email) || null,
        latitude,
        longitude,
        status: (str(body.status, "online") as "online") ?? "online",
        openingTime: str(body.openingTime, "06:00"),
        closingTime: str(body.closingTime, "23:00"),
        notes: str(body.notes) || null,
      }));
  } catch (error) {
    uniqueViolation(error, "A station with this code", "station code");
  }
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "station",
      entityId: station.id,
      entityLabel: station.name,
      summary: `${ctx.user.name} created station ${station.name}`,
      next: station,
      request,
    }));
    return jsonCreated(station);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
