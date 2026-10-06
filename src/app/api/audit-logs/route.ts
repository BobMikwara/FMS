import { stationScopeForUser } from "@/server/auth/authorization";
import { getOrganization, listAuditLogs } from "@/server/db/repo/core";
import { normalizeTimeZone } from "@/server/services/time-zone";
import { jsonError, jsonOk, parsePagination, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("audit.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const { page, pageSize } = parsePagination(params, 30);
    const [result, organization] = await Promise.all([
      listAuditLogs({
        orgId: ctx.user.organizationId,
        userId: params.get("userId") ?? undefined,
        entity: params.get("entityType") ?? params.get("entity") ?? undefined,
        action: params.get("action") ?? undefined,
        search: params.get("search") ?? undefined,
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
        page,
        pageSize,
        stationIds: stationScopeForUser(ctx.user),
      }),
      getOrganization(ctx.user.organizationId),
    ]);
    const timeZone = normalizeTimeZone(organization?.timezone);
    const rows = result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      actorName: row.userLabel,
      actorEmail: "",
      ipAddress: row.ip,
      createdAt: row.ts,
      timeZone,
      metadata: row.summary,
    }));
    return jsonOk({ rows, total: result.total, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
