import { completePasswordReset } from "@/server/auth/session";
import { badRequest, clientIp, jsonError, jsonOk, parseJsonBody, rateLimit, unprocessable } from "@/server/api/route";

export async function POST(request: Request) {
  try {
    rateLimit(`reset:${clientIp(request) ?? "unknown"}`, 10, 900);
    const body = await parseJsonBody<{ token?: string; password?: string }>(request);
    if (!body.token || !body.password) {
      return jsonError(unprocessable("A reset token and a new password are required."));
    }
    if (body.password.length < 10) {
      return jsonError(unprocessable("Your new password must be at least 10 characters long."));
    }
    const result = await completePasswordReset(body.token, body.password);
    if (!result.ok) {
      return jsonError(badRequest(result.error ?? "Reset failed."));
    }
    return jsonOk({ reset: true });
  } catch (error) {
    return jsonError(error as Error, request);
  }
}
