import { stationScopeForUser } from "@/server/auth/authorization";
import { globalSearch } from "@/server/services/analytics";
import { hasPermission } from "@/server/auth/session";
import { jsonError, jsonOk, withAnyPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withAnyPermission(
  ["stations.view", "tanks.view", "devices.view", "vehicles.view", "alerts.view", "users.view", "reports.view"],
  async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const q = params.get("q") ?? "";
    if (q.trim().length < 1) return jsonOk({ query: q, hits: [], total: 0 });
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 8) || 8, 1), 25);
    const allowedKinds = [
      hasPermission(ctx.user, "stations.view") ? "station" : null,
      hasPermission(ctx.user, "tanks.view") ? "tank" : null,
      hasPermission(ctx.user, "devices.view") ? "device" : null,
      hasPermission(ctx.user, "vehicles.view") ? "vehicle" : null,
      hasPermission(ctx.user, "alerts.view") ? "alert" : null,
      hasPermission(ctx.user, "users.view") ? "user" : null,
      hasPermission(ctx.user, "reports.view") ? "report" : null,
    ].filter((kind): kind is "station" | "tank" | "device" | "vehicle" | "alert" | "user" | "report" => kind !== null);
    const hits = (await globalSearch(ctx.user.organizationId, q, limit, stationScopeForUser(ctx.user), allowedKinds));
    const grouped: Record<string, typeof hits> = {};
    for (const hit of hits) {
      (grouped[hit.kind] ??= []).push(hit);
    }
    return jsonOk({ query: q, hits, grouped, total: hits.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
