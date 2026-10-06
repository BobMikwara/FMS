import { confirmMfaEnrollment } from "@/server/auth/mfa";
import { setSessionCookie } from "@/server/auth/session";
import { audit, jsonError, jsonOk, parseJsonBody, rateLimit, unprocessable, withAuth } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (request, ctx) => {
  const body = await parseJsonBody<{ code?: string }>(request);
  const code = String(body.code ?? "").trim();
  if (!code) return jsonError(unprocessable("Enter the six-digit code from your authenticator app."), request);
  await rateLimit(`mfa-confirm:${ctx.user.id}`, 10, 300);
  const result = await confirmMfaEnrollment(ctx.user.id, code);
  if (!result.ok || !result.recoveryCodes) {
    return jsonError(unprocessable(result.error ?? "MFA enrollment could not be completed."), request);
  }
  await setSessionCookie({
    sub: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    orgId: ctx.user.organizationId,
    roleId: ctx.user.roleId,
    roleKey: ctx.user.roleKey,
    permissions: ctx.user.permissions,
  });
  await audit({
    user: ctx.user,
    action: "mfa_enabled",
    entity: "user_security",
    entityId: ctx.user.id,
    entityLabel: ctx.user.email,
    summary: "Enabled authenticator MFA and generated recovery codes.",
    request,
  });
  return jsonOk({ enabled: true, recoveryCodes: result.recoveryCodes });
});
