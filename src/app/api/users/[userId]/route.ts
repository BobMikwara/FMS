import { hasOrganizationWideStationAccess, isPlatformOwner, userCanAccessStation, userCanAccessStationScopedUser } from "@/server/auth/authorization";
import { getUser, listRoles, listUsers, setUserStations, suspendUser, updateUser } from "@/server/db/repo/core";
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
    const user = (await getUser(ctx.params?.userId ?? ""));
    if (
      !user ||
      user.organizationId !== ctx.user.organizationId ||
      !userCanAccessStationScopedUser(ctx.user, user.stationIds, user.roleKey)
    ) return jsonError(notFound(), request);
    return jsonOk({ ...user, stationIds: user.stationIds.filter((stationId) => userCanAccessStation(ctx.user, stationId)) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("users.edit", async (request, ctx) => {
  try {
    const userId = ctx.params?.userId ?? "";
    const existing = (await getUser(userId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStationScopedUser(ctx.user, existing.stationIds, existing.roleKey)
    ) return jsonError(notFound(), request);

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "phone", "jobTitle", "status", "roleId", "mfaEnabled"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    let nextRoleKey = existing.roleKey;
    if (patch.roleId !== undefined) {
      const requestedRoleId = String(patch.roleId ?? "").trim();
      if (!requestedRoleId) throw new ApiError(422, "Select a valid role.", "validation_error");
      const roles = (await listRoles());
      const role = roles.find((row) => row.id === requestedRoleId);
      if (!role) throw new ApiError(422, "Select a valid role.", "validation_error");
      patch.roleId = requestedRoleId;
      nextRoleKey = role.key;
      if (isPlatformOwner(role.key) && !isPlatformOwner(ctx.user.roleKey)) {
        throw new ApiError(403, "Only an owner can grant owner access.", "forbidden");
      }
      if (!hasOrganizationWideStationAccess(ctx.user) && (role.key === "admin" || isPlatformOwner(role.key))) {
        throw new ApiError(403, "A station-scoped user cannot grant organization-wide access.", "forbidden");
      }
    }
    if (patch.status != null && !["active", "invited", "suspended"].includes(String(patch.status))) {
      throw new ApiError(422, "Select a supported account status.", "validation_error");
    }
    if (isPlatformOwner(existing.roleKey) && !isPlatformOwner(ctx.user.roleKey)) {
      throw new ApiError(403, "Only an owner can modify another owner account.", "forbidden");
    }
    const isRemovingActiveOwner = isPlatformOwner(existing.roleKey) && existing.status === "active" &&
      (!isPlatformOwner(nextRoleKey) || (patch.status !== undefined && patch.status !== "active"));
    if (isRemovingActiveOwner) {
      const activeOwnerCount = (await listUsers(ctx.user.organizationId))
        .filter((candidate) => isPlatformOwner(candidate.roleKey) && candidate.status === "active").length;
      if (activeOwnerCount <= 1) {
        throw new ApiError(409, "An organization must keep at least one active owner.", "conflict");
      }
    }
    if (userId === ctx.user.id && patch.status !== undefined && patch.status !== existing.status) {
      throw new ApiError(422, "You cannot change your own account status.", "validation_error");
    }
    if (body.password) {
      const password = String(body.password);
      if (password.length < 10) {
        throw new ApiError(422, "A password must be at least 10 characters long.", "validation_error");
      }
      patch.passwordHash = await hashPassword(password);
    }

    let stationIdsToSet: string[] | undefined;
    if (Array.isArray(body.stationIds)) {
      const stations = (await listAllStations(ctx.user.organizationId));
      const requestedStationIds = [...new Set(body.stationIds as string[])];
      if (requestedStationIds.some((id) => !stations.some((station) => station.id === id))) {
        throw new ApiError(422, "One or more selected stations do not exist in your organization.", "validation_error");
      }
      if (requestedStationIds.some((id) => !userCanAccessStation(ctx.user, id))) {
        throw new ApiError(403, "You cannot assign a user to a station outside your own scope.", "forbidden");
      }
      const outsideScope = hasOrganizationWideStationAccess(ctx.user)
        ? []
        : existing.stationIds.filter((id) => !userCanAccessStation(ctx.user, id));
      stationIdsToSet = [...new Set([...outsideScope, ...requestedStationIds])];
    }

    if (userId === ctx.user.id && !hasOrganizationWideStationAccess(ctx.user)) {
      const roleChanged = patch.roleId !== undefined && String(patch.roleId) !== existing.roleId;
      const stationAssignmentsChanged = stationIdsToSet !== undefined && (
        stationIdsToSet.length !== existing.stationIds.length ||
        stationIdsToSet.some((stationId) => !existing.stationIds.includes(stationId))
      );
      if (roleChanged || stationAssignmentsChanged) {
        throw new ApiError(403, "A station-scoped user cannot change their own role or station assignments.", "forbidden");
      }
      stationIdsToSet = undefined;
    }

    const user = (await updateUser(userId, patch));
    if (!user) return jsonError(notFound(), request);
    if (stationIdsToSet !== undefined) {
      (await setUserStations(userId, stationIdsToSet));
      user.stationIds = stationIdsToSet;
    }

    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "user",
      entityId: user.id,
      entityLabel: user.email,
      summary: `${ctx.user.name} updated ${user.email}`,
      previous: existing,
      next: user,
      request,
    }));
    return jsonOk({ ...user, stationIds: user.stationIds.filter((stationId) => userCanAccessStation(ctx.user, stationId)) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const DELETE = withPermission("users.delete", async (request, ctx) => {
  try {
    const userId = ctx.params?.userId ?? "";
    const existing = (await getUser(userId));
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStationScopedUser(ctx.user, existing.stationIds, existing.roleKey)
    ) return jsonError(notFound(), request);
    if (userId === ctx.user.id) {
      throw new ApiError(422, "You cannot suspend your own account.", "validation_error");
    }
    if (isPlatformOwner(existing.roleKey) && !isPlatformOwner(ctx.user.roleKey)) {
      throw new ApiError(403, "Only an owner can suspend another owner account.", "forbidden");
    }
    if (isPlatformOwner(existing.roleKey) && existing.status === "active") {
      const activeOwners = (await listUsers(ctx.user.organizationId))
        .filter((user) => isPlatformOwner(user.roleKey) && user.status === "active");
      if (activeOwners.length <= 1) {
        throw new ApiError(409, "An organization must keep at least one active owner.", "conflict");
      }
    }
    const suspended = await suspendUser(userId);
    (await audit({
      user: ctx.user,
      action: "suspended",
      entity: "user",
      entityId: existing.id,
      entityLabel: existing.email,
      summary: `${ctx.user.name} suspended ${existing.email}`,
      previous: existing,
      next: suspended,
      request,
    }));
    return jsonOk({ id: userId, suspended: true, deleted: false });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
