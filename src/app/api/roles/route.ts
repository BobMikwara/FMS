import { listRoles, updateRole } from "@/server/db/repo/core";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, unprocessable, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("roles.view", async (request, ctx) => {
  try {
    // Roles are system-wide definitions; the org is carried by the users that hold them.
    const roles = listRoles();
    return jsonOk({ rows: roles, total: roles.length });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

/**
 * Roles are seeded with their permission set. Editing is intentionally limited
 * to the display name, description and enabled flag — changing the permission
 * matrix itself is a deployment-time decision recorded in code review.
 */
export const PATCH = withPermission("roles.manage", async (request, ctx) => {
  try {
    const body = await parseJsonBody<{ id?: string; name?: string; description?: string }>(request);
    if (!body.id) {
      return jsonError(unprocessable("Role id is required."));
    }
    const existing = listRoles().find((role) => role.id === body.id);
    if (!existing) return jsonError(notFound(), request);
    const role = updateRole(body.id, { name: body.name, description: body.description });
    if (!role) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "role",
      entityId: role.id,
      entityLabel: role.name,
      summary: `${ctx.user.name} updated role ${role.name}`,
      previous: existing,
      next: role,
      request,
    });
    return jsonOk(role);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
