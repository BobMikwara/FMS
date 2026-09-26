import { buildDashboard } from "@/server/services/analytics";
import { jsonError, jsonOk, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("dashboard.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const period = (params.get("period") ?? "7d") as "today" | "7d" | "30d" | "90d";
    const data = buildDashboard(ctx.user.organizationId, period);
    return jsonOk(data);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
