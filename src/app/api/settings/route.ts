import { hasPermission } from "@/server/auth/permissions";
import { getSettings, setSettings } from "@/server/db/repo/core";
import { validateOperationalSettingsPatch } from "@/server/domain/system-config";
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
    // Keep existing inert settings, such as the legacy retention value, but
    // validate and persist only operator controls that have runtime consumers.
    const current = await getSettings(ctx.user.organizationId);
    const groups: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (key === "system") {
        const validation = validateOperationalSettingsPatch(value);
        if (!validation.ok) return jsonError(unprocessable(validation.message));
        const previous = current.system && typeof current.system === "object" && !Array.isArray(current.system)
          ? current.system as Record<string, unknown>
          : {};
        groups.system = { ...previous, ...validation.value };
      } else {
        return jsonError(unprocessable(`The ${key} settings group is not operational and cannot be updated.`));
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
