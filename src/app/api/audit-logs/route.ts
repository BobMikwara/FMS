import { listAuditLogs } from "@/server/db/repo/core";
import { jsonError, jsonOk, parsePagination, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("audit.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 30);
    const result = (await listAuditLogs({
      orgId: ctx.user.organizationId,
      userId: params.get("userId") ?? undefined,
      entity: params.get("entity") ?? undefined,
      action: params.get("action") ?? undefined,
      search: params.get("search") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      page,
      pageSize,
    }));
    return jsonOk({ rows: result.rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
