import { stationScopeForUser } from "@/server/auth/authorization";
import { buildDashboard } from "@/server/services/analytics";
import { publicDevice } from "@/server/services/device-response";
import { jsonError, jsonOk, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("dashboard.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const period = (params.get("period") ?? "7d") as "today" | "7d" | "30d" | "90d";
    const data = (await buildDashboard(ctx.user.organizationId, period, stationScopeForUser(ctx.user)));
    return jsonOk({ ...data, deviceHealth: data.deviceHealth.map(publicDevice) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
