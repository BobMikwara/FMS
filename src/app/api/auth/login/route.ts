import { authenticate, setSessionCookie } from "@/server/auth/session";
import { clientIp, jsonError, jsonOk, parseJsonBody, rateLimit, unauthorized, unprocessable } from "@/server/api/route";

export async function POST(request: Request) {
  try {
    const ip = clientIp(request) ?? "unknown";
    await rateLimit(`login:${ip}`, 12, 300);
    const body = await parseJsonBody<{ email?: string; password?: string; remember?: boolean }>(request);
    if (!body.email || !body.password) {
      return jsonError(unprocessable("Email and password are required."));
    }
    const result = await authenticate(body.email, body.password, ip);
    if (!result.ok || !result.user) {
      return jsonError(unauthorized(result.error ?? "Sign in failed."));
    }
    await setSessionCookie({
      sub: result.user.id,
      email: result.user.email,
      name: result.user.name,
      orgId: result.user.organizationId,
      roleId: result.user.roleId,
      roleKey: result.user.roleKey,
      permissions: result.user.permissions,
    });
    return jsonOk({ user: result.user, redirectTo: "/" });
  } catch (error) {
    return jsonError(error as Error, request);
  }
}
