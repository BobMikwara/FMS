import { beginMfaEnrollment, reauthenticateUser } from "@/server/auth/mfa";
import { audit, jsonError, jsonOk, parseJsonBody, rateLimit, unauthorized, unprocessable, withAuth } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (request, ctx) => {
  const body = await parseJsonBody<{ password?: string }>(request);
  if (!body.password) return jsonError(unprocessable("Confirm your current password to begin MFA setup."), request);
  await rateLimit(`mfa-enrollment:${ctx.user.id}`, 5, 300);
  if (!await reauthenticateUser(ctx.user.id, body.password)) {
    return jsonError(unauthorized("Password confirmation failed."), request);
  }
  const enrollment = await beginMfaEnrollment(ctx.user.id, ctx.user.email);
  await audit({
    user: ctx.user,
    action: "mfa_enrollment_started",
    entity: "user_security",
    entityId: ctx.user.id,
    entityLabel: ctx.user.email,
    summary: "Started authenticator MFA enrollment.",
    request,
  });
  return jsonOk(enrollment);
});
