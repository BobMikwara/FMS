import { deleteUser, getUser, listRoles, listUsers, setUserStations, updateUser } from "@/server/db/repo/core";
import { hashPassword } from "@/server/auth/session";
import { listAllStations } from "@/server/db/repo/stations";
import {
  ApiError,
  audit,
  jsonError,
  jsonOk,
  notFound,
  parseJsonBody,
  withPermission,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("users.view", async (request, ctx) => {
  try {
    const user = getUser(ctx.params?.userId ?? "");
    if (!user || user.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    return jsonOk(user);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("users.edit", async (request, ctx) => {
  try {
    const userId = ctx.params?.userId ?? "";
    const existing = getUser(userId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "phone", "jobTitle", "status", "roleId", "mfaEnabled"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.roleId != null) {
      const roles = listRoles();
      const role = roles.find((row) => row.id === patch.roleId);
      if (!role) throw new ApiError(422, "Select a valid role.", "validation_error");
      if (role.key === "super_admin" && ctx.user.roleKey !== "super_admin") {
        throw new ApiError(403, "Only an owner can grant owner access.", "forbidden");
      }
    }
    if (body.password) {
      const password = String(body.password);
      if (password.length < 10) {
        throw new ApiError(422, "A password must be at least 10 characters long.", "validation_error");
      }
      patch.passwordHash = await hashPassword(password);
    }

    const user = updateUser(userId, patch);
    if (!user) return jsonError(notFound(), request);

    if (Array.isArray(body.stationIds)) {
      const stations = listAllStations(ctx.user.organizationId);
      const stationIds = (body.stationIds as string[]).filter((id) => stations.some((station) => station.id === id));
      setUserStations(userId, stationIds);
      user.stationIds = stationIds;
    }

    audit({
      user: ctx.user,
      action: "updated",
      entity: "user",
      entityId: user.id,
      entityLabel: user.email,
      summary: `${ctx.user.name} updated ${user.email}`,
      previous: existing,
      next: user,
      request,
    });
    return jsonOk(user);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("users.delete", async (request, ctx) => {
  try {
    const userId = ctx.params?.userId ?? "";
    const existing = getUser(userId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);
    if (userId === ctx.user.id) {
      throw new ApiError(422, "You cannot delete your own account.", "validation_error");
    }
    const owners = listUsers(ctx.user.organizationId).filter((user) => user.roleKey === "super_admin");
    if (existing.roleKey === "super_admin" && owners.length <= 1) {
      throw new ApiError(409, "An organization must keep at least one owner.", "conflict");
    }
    deleteUser(userId);
    audit({
      user: ctx.user,
      action: "deleted",
      entity: "user",
      entityId: existing.id,
      entityLabel: existing.email,
      summary: `${ctx.user.name} deleted ${existing.email}`,
      previous: existing,
      request,
    });
    return jsonOk({ id: userId, deleted: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
