import { globalSearch } from "@/server/services/analytics";
import { jsonError, jsonOk, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("stations.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const q = params.get("q") ?? "";
    if (q.trim().length < 1) return jsonOk({ query: q, hits: [], total: 0 });
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 8) || 8, 1), 25);
    const hits = globalSearch(ctx.user.organizationId, q, limit);
    const grouped: Record<string, typeof hits> = {};
    for (const hit of hits) {
      (grouped[hit.kind] ??= []).push(hit);
    }
    return jsonOk({ query: q, hits, grouped, total: hits.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
