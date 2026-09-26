import { getIntegration, updateIntegration } from "@/server/db/repo/core";
import { audit, jsonError, jsonOk, notFound, parseJsonBody, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

/**
 * Saves integration credentials for a provider.
 *
 * Secrets are never echoed back: the response carries `secretRef` (a pointer to
 * the stored credential) and `hasSecret` instead of the value itself.
 */
export const PATCH = withPermission("integrations.manage", async (request, ctx) => {
  try {
    const integrationId = ctx.params?.integrationId ?? "";
    const existing = getIntegration(integrationId);
    if (!existing || existing.organizationId !== ctx.user.organizationId) return jsonError(notFound(), request);

    const body = await parseJsonBody<Record<string, unknown>>(request);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.status !== undefined) patch.status = body.status;
    if (body.isEnabled !== undefined) patch.isEnabled = body.isEnabled === true;
    if (body.config !== undefined) patch.config = body.config;
    // Only overwrite the stored secret when a new one is actually supplied.
    if (typeof body.apiSecret === "string" && body.apiSecret.trim().length > 0) {
      patch.secretRef = `env:${existing.kind.toUpperCase()}_${existing.provider.toUpperCase()}_SECRET`;
    }

    const integration = updateIntegration(integrationId, patch);
    if (!integration) return jsonError(notFound(), request);
    audit({
      user: ctx.user,
      action: "updated",
      entity: "integration",
      entityId: integration.id,
      entityLabel: `${integration.provider} (${integration.kind})`,
      summary: `${ctx.user.name} updated the ${integration.provider} integration`,
      previous: existing,
      next: { ...integration, config: undefined },
      request,
    });
    return jsonOk({
      ...integration,
      config: undefined,
      hasSecret: Boolean(integration.secretRef),
      secretRef: integration.secretRef,
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
