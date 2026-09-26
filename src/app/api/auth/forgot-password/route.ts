import { requestPasswordReset } from "@/server/auth/session";
import { clientIp, jsonError, jsonOk, parseJsonBody, rateLimit, unprocessable } from "@/server/api/route";

export async function POST(request: Request) {
  try {
    rateLimit(`forgot:${clientIp(request) ?? "unknown"}`, 5, 900);
    const body = await parseJsonBody<{ email?: string }>(request);
    if (!body.email) {
      return jsonError(unprocessable("Enter the email address on your account."));
    }
    const result = await requestPasswordReset(body.email);
    // Always return the same shape so the endpoint cannot be used to enumerate accounts.
    return jsonOk({
      requested: true,
      // Only present in demo environments without a mail transport.
      resetUrl: result ? `/reset-password?token=${result.token}` : undefined,
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
}
