import { requestPasswordReset } from "@/server/auth/session";
import { sendPasswordResetEmail } from "@/server/email/mailer";
import { clientIp, jsonError, jsonOk, parseJsonBody, rateLimit, unprocessable } from "@/server/api/route";

export async function POST(request: Request) {
  try {
    await rateLimit(`forgot:${clientIp(request) ?? "unknown"}`, 5, 900);
    const body = await parseJsonBody<{ email?: string }>(request);
    if (!body.email) {
      return jsonError(unprocessable("Enter the email address on your account."));
    }
    const result = await requestPasswordReset(body.email);
    if (result) {
      try {
        await sendPasswordResetEmail({ to: result.user.email, name: result.user.name, token: result.token });
      } catch (error) {
        console.error("[mail] password reset delivery failed", error);
      }
    }
    // Never return a token or reveal whether the account exists.
    return jsonOk({ requested: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
}
