import { completeMfaLogin } from "@/server/auth/mfa";
import { setSessionCookie } from "@/server/auth/session";
import { clientIp, jsonError, jsonOk, parseJsonBody, rateLimit, unauthorized, unprocessable } from "@/server/api/route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ip = clientIp(request) ?? "unknown";
    await rateLimit(`mfa-login:${ip}`, 20, 300);
    const body = await parseJsonBody<{ challengeToken?: string; code?: string }>(request);
    const challengeToken = String(body.challengeToken ?? "");
    const code = String(body.code ?? "").trim();
    if (!challengeToken || !code) {
      return jsonError(unprocessable("A sign-in challenge and authenticator or recovery code are required."), request);
    }
    const result = await completeMfaLogin(challengeToken, code, ip);
    if (!result.ok || !result.user) {
      return jsonError(unauthorized(result.error ?? "The authenticator or recovery code is not valid."), request);
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
