import { hasPermission } from "@/server/auth/permissions";
import { getSettings, setSettings } from "@/server/db/repo/core";
import { audit, jsonError, jsonOk, parseJsonBody, unprocessable, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("settings.view", async (request, ctx) => {
  try {
    const settings = await getSettings(ctx.user.organizationId);
    const notifications = settings.notifications;
    if (
      !hasPermission(ctx.user, "settings.manage") &&
      notifications !== null &&
      typeof notifications === "object" &&
      !Array.isArray(notifications)
    ) {
      return jsonOk({ ...settings, notifications: { ...notifications, recipients: [] } });
    }
    return jsonOk(settings);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const PATCH = withPermission("settings.manage", async (request, ctx) => {
  try {
    const body = await parseJsonBody<Record<string, unknown>>(request);
    // Only the known settings groups are writable, so a malformed payload can
    // never corrupt unrelated configuration.
    const groups: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        groups[key] = value as Record<string, unknown>;
      }
    }
    if (Object.keys(groups).length === 0) {
      return jsonError(unprocessable("Provide at least one settings group to update."));
    }
    const settings = (await setSettings(ctx.user.organizationId, groups));
    (await audit({
      user: ctx.user,
      action: "updated",
      entity: "settings",
      entityId: ctx.user.organizationId,
      entityLabel: "Organization settings",
      summary: `${ctx.user.name} updated settings (${Object.keys(groups).join(", ")})`,
      next: groups,
      request,
    }));
    return jsonOk(settings);
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
