import { userCanAccessStation } from "@/server/auth/authorization";
import { jsonError, jsonOk, notFound, parsePagination, unprocessable, withPermission } from "@/server/api/route";
import { getVehicle } from "@/server/db/repo/devices";
import { latestPositionForVehicle, listVehiclePositions } from "@/server/db/repo/vehicle-positions";

export const dynamic = "force-dynamic";

export const GET = withPermission("devices.view", async (request, ctx) => {
  try {
    const vehicle = await getVehicle(ctx.params?.vehicleId ?? "");
    if (
      !vehicle ||
      vehicle.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, vehicle.stationId)
    ) return jsonError(notFound(), request);

    const params = new URL(request.url).searchParams;
    const fromParam = params.get("from");
    const toParam = params.get("to");
    const from = fromParam ?? new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const to = toParam ?? new Date().toISOString();
    if (
      (fromParam !== null && !Number.isFinite(Date.parse(from))) ||
      (toParam !== null && !Number.isFinite(Date.parse(to))) ||
      Date.parse(from) > Date.parse(to)
    ) return jsonError(unprocessable("Use valid ISO timestamps with from earlier than or equal to to."), request);

    const { page, pageSize } = parsePagination(params, 100, 500);
    const result = await listVehiclePositions({
      organizationId: vehicle.organizationId,
      vehicleId: vehicle.id,
      from,
      to,
      page,
      pageSize,
    });
    const latest = await latestPositionForVehicle(vehicle.organizationId, vehicle.id);
    return jsonOk({
      vehicleId: vehicle.id,
      from,
      to,
      rows: result.rows.map(({ eventKey: _eventKey, ...position }) => position),
      total: result.total,
      page,
      pageSize,
      latest: latest ? (({ eventKey: _eventKey, ...position }) => position)(latest) : null,
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
