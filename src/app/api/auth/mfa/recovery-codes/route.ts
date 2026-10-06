import { reauthenticateUser, rotateMfaRecoveryCodes } from "@/server/auth/mfa";
import { setSessionCookie } from "@/server/auth/session";
import { audit, jsonError, jsonOk, parseJsonBody, rateLimit, unauthorized, unprocessable, withAuth } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (request, ctx) => {
  const body = await parseJsonBody<{ password?: string; code?: string }>(request);
  const password = String(body.password ?? "");
  const code = String(body.code ?? "").trim();
  if (!password || !code) {
    return jsonError(unprocessable("Your current password and an authenticator or recovery code are required."), request);
  }
  await rateLimit(`mfa-recovery-rotate:${ctx.user.id}`, 5, 300);
  if (!await reauthenticateUser(ctx.user.id, password)) {
    return jsonError(unauthorized("Password confirmation failed."), request);
  }
  const result = await rotateMfaRecoveryCodes(ctx.user.id, code);
  if (!result.ok || !result.recoveryCodes) {
    return jsonError(unprocessable(result.error ?? "Recovery codes could not be rotated."), request);
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
    action: "mfa_recovery_codes_rotated",
    entity: "user_security",
    entityId: ctx.user.id,
    entityLabel: ctx.user.email,
    summary: "Rotated authenticator recovery codes.",
    request,
  });
  return jsonOk({ recoveryCodes: result.recoveryCodes });
});
