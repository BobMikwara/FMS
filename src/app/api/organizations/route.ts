import { listOrganizations, updateOrganization } from "@/server/db/repo/core";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("organizations.manage", async (request, ctx) => {
  try {
    const rows = (await listOrganizations()).filter((organization) => organization.id === ctx.user.organizationId);
    return jsonOk({ rows, total: rows.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("organizations.manage", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "slug", "currency", "units", "tempUnit", "timezone", "locale", "logoUrl"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const organization = (await updateOrganization(ctx.user.organizationId, patch));
    if (!organization) {
      return jsonError(notFound("Organization not found."));
    }
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "organization",
      entityId: organization.id,
      entityLabel: organization.name,
      summary: `${ctx.user.name} updated organization settings for ${organization.name}`,
      next: organization,
      request,
    }));
    return jsonOk(organization);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
