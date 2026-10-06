import { listIntegrations } from "@/server/db/repo/core";
import { listProviderInfo } from "@/server/integrations/providers";
import { jsonError, jsonOk, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("integrations.view", async (request, ctx) => {
  try {
    const rows = (await listIntegrations(ctx.user.organizationId));
    const visibleRows = rows.map((integration) => ({ ...integration, config: undefined }));
    return jsonOk({ rows: visibleRows, total: visibleRows.length, providers: listProviderInfo() });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
