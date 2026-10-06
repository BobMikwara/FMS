import { userCanAccessStationScopedUser } from "@/server/auth/authorization";
import { createInvitationToken } from "@/server/auth/session";
import { audit, ApiError, conflict, jsonError, jsonOk, notFound, withPermission } from "@/server/api/route";
import { getUser } from "@/server/db/repo/core";
import { sendUserInvitationEmail } from "@/server/email/mailer";

export const dynamic = "force-dynamic";

export const POST = withPermission("users.edit", async (request, ctx) => {
  try {
    const userId = ctx.params?.userId ?? "";
    const existing = await getUser(userId);
    if (
      !existing ||
      existing.organizationId !== ctx.user.organizationId ||
      !userCanAccessStationScopedUser(ctx.user, existing.stationIds, existing.roleKey)
    ) return jsonError(notFound(), request);
    if (existing.status !== "invited") {
      return jsonError(conflict("Only an invited account can receive an activation link."), request);
    }

    const invitation = await createInvitationToken(existing.id);
    if (!invitation) return jsonError(notFound(), request);

    let sent = false;
    try {
      sent = await sendUserInvitationEmail({
        to: invitation.user.email,
        name: invitation.user.name,
        token: invitation.token,
      });
    } catch {
      sent = false;
    }
    if (!sent) {
      return jsonError(
        new ApiError(503, "The invitation link could not be emailed. Check SMTP and AUTH_URL, then retry.", "mail_unavailable"),
        request,
      );
    }

    await audit({
      user: ctx.user,
      action: "invitation_sent",
      entity: "user",
      entityId: existing.id,
      entityLabel: existing.email,
      summary: `${ctx.user.name} sent an account activation link to ${existing.email}`,
      request,
    });
    return jsonOk({ id: existing.id, invitationEmailSent: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
