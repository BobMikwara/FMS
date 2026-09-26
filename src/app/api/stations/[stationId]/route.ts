import { deleteStation, getStation, listStations, updateStation } from "@/server/db/repo/stations";
import { buildStationDetail } from "@/server/services/analytics";
import {
  ApiError,
  audit,
  forbidden,
  jsonError,
  jsonOk,
  notFound,
  parseJsonBody,
  withAnyPermission,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("stations.view", async (request, ctx) => {
  try {
    const stationId = ctx.params?.stationId ?? "";
    const detail = (await buildStationDetail(stationId));
    if (
      !detail ||
      detail.station.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(stationId))
    ) return jsonError(notFound(), request);
    return jsonOk(detail);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("stations.edit", async (request, ctx) => {
  try {
    const stationId = ctx.params?.stationId ?? "";
    const existing = (await getStation(stationId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(stationId))
    ) return jsonError(notFound(), request);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    const allowed = [
      "name",
      "code",
      "address",
      "city",
      "region",
      "country",
      "phone",
      "email",
      "latitude",
      "longitude",
      "status",
      "openingTime",
      "closingTime",
      "timezone",
      "currency",
      "volumeUnit",
      "notes",
      "isArchived",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.latitude != null && Math.abs(Number(patch.latitude)) > 90) {
      throw new ApiError(422, "Latitude must be between -90 and 90.", "validation_error");
    }
    if (patch.longitude != null && Math.abs(Number(patch.longitude)) > 180) {
      throw new ApiError(422, "Longitude must be between -180 and 180.", "validation_error");
    }
    const station = (await updateStation(stationId, patch));
    if (!station) return jsonError(notFound(), request);
    (await audit({
      user: ctx.user,
      action: patch.isArchived ? "archived" : "updated",
      entity: "station",
      entityId: station.id,
      entityLabel: station.name,
      summary: `${ctx.user.name} ${patch.isArchived ? "archived" : "updated"} station ${station.name}`,
      previous: existing,
      next: station,
      request,
    }));
    return jsonOk(station);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("stations.delete", async (request, ctx) => {
  try {
    const stationId = ctx.params?.stationId ?? "";
    const existing = (await getStation(stationId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      (ctx.user.stationIds.length > 0 && !ctx.user.stationIds.includes(stationId))
    ) return jsonError(notFound(), request);
    // Soft-delete by default; a hard delete requires the explicit `?hard=true` flag.
    const hard = new URL(request.url).searchParams.get("hard") === "true";
    if (hard) {
      (await deleteStation(stationId));
    } else {
      (await updateStation(stationId, { isArchived: true, status: "offline" }));
    }
    (await audit({
      user: ctx.user,
      action: hard ? "deleted" : "archived",
      entity: "station",
      entityId: existing.id,
      entityLabel: existing.name,
      summary: `${ctx.user.name} ${hard ? "deleted" : "archived"} station ${existing.name}`,
      previous: existing,
      request,
    }));
    return jsonOk({ id: stationId, archived: !hard, deleted: hard });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
