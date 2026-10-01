import { hasOrganizationWideStationAccess, isPlatformOwner, stationScopeForUser, userCanAccessStation, userCanAccessStationScopedUser } from "@/server/auth/authorization";
import type { User } from "@/server/domain/types";
import { createUser, listRoles, listUsers, setUserStations } from "@/server/db/repo/core";
import { listAllStations } from "@/server/db/repo/stations";
import { hashPassword } from "@/server/auth/session";
import {
  ApiError,
  audit,
  jsonCreated,
  jsonError,
  jsonOk,
  maxLen,
  parseJsonBody,
  parsePagination,
  required,
  str,
  withPermission,
  uniqueViolation,
} from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("users.view", async (request, ctx) => {
  try {
    const params = new URL(request.url).searchParams;
    const search = params.get("search") ?? undefined;
    let rows = (await listUsers(ctx.user.organizationId, stationScopeForUser(ctx.user)))
      .filter((user) => userCanAccessStationScopedUser(ctx.user, user.stationIds, user.roleKey));
    if (search) {
      const term = search.toLowerCase();
      rows = rows.filter((user) => `${user.name} ${user.email} ${user.roleName}`.toLowerCase().includes(term));
    }
    const { page, pageSize } = parsePagination(params, 20);
    const paged = rows.slice((page - 1) * pageSize, page * pageSize).map((user) => ({
      ...user,
      stationIds: user.stationIds.filter((stationId) => userCanAccessStation(ctx.user, stationId)),
    }));
    return jsonOk({ rows: paged, total: rows.length, page, pageSize });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("users.create", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    const email = required(body.email, "Email").toLowerCase().trim();
    const name = maxLen(required(body.name, "Full name"), 120, "Full name");
    const roleId = required(body.roleId, "Role");
    const password = String(body.password ?? "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(422, "Enter a valid email address.", "validation_error");
    }
    if (password.length < 10) {
      throw new ApiError(422, "A temporary password of at least 10 characters is required.", "validation_error");
    }

    const roles = (await listRoles());
    const role = roles.find((row) => row.id === roleId);
    if (!role) throw new ApiError(422, "Select a valid role.", "validation_error");
    // Only organization-wide administrators may create organization-wide roles.
    if (isPlatformOwner(role.key) && !isPlatformOwner(ctx.user.roleKey)) {
      throw new ApiError(403, "Only an owner can create another owner account.", "forbidden");
    }
    if (!hasOrganizationWideStationAccess(ctx.user) && (role.key === "admin" || isPlatformOwner(role.key))) {
      throw new ApiError(403, "A station-scoped user cannot grant organization-wide access.", "forbidden");
    }

    const stations = (await listAllStations(ctx.user.organizationId));
    const requestedStations = Array.isArray(body.stationIds) ? (body.stationIds as string[]) : [];
    const stationIds = [...new Set(requestedStations)];
    if (stationIds.some((id) => !stations.some((station) => station.id === id))) {
      throw new ApiError(422, "One or more selected stations do not exist in your organization.", "validation_error");
    }
    if (stationIds.some((id) => !userCanAccessStation(ctx.user, id))) {
      throw new ApiError(403, "You cannot assign a user to a station outside your own scope.", "forbidden");
    }
    const organizationWideRole = role.key === "admin" || isPlatformOwner(role.key);
    if (!organizationWideRole && stationIds.length === 0) {
      throw new ApiError(422, "Assign at least one station to every non-administrator account.", "validation_error");
    }

  let user!: User;
  try {
      user = (await createUser({
        organizationId: ctx.user.organizationId,
        email,
        name,
        roleId,
        passwordHash: await hashPassword(password),
        phone: str(body.phone) || null,
        jobTitle: str(body.jobTitle) || null,
        status: "invited",
        mfaEnabled: body.mfaEnabled === true,
      }));
  } catch (error) {
    uniqueViolation(error, "An account with this email address", "email address");
  }
    (await setUserStations(user.id, stationIds));

    (await audit({
      user: ctx.user,
      action: "created",
      entity: "user",
      entityId: user.id,
      entityLabel: user.email,
      summary: `${ctx.user.name} invited ${user.email} as ${role.name}`,
      next: { ...user, stationIds },
      request,
    }));
    return jsonCreated({ ...user, stationIds });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
