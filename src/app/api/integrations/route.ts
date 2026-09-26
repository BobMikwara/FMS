import { listIntegrations } from "@/server/db/repo/core";
import { listProviderInfo } from "@/server/integrations/providers";
import { jsonError, jsonOk, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("integrations.view", async (request, ctx) => {
  try {
    const rows = listIntegrations(ctx.user.organizationId);
    return jsonOk({ rows, total: rows.length, providers: listProviderInfo() });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
