import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];
const PUBLIC_API = ["/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/webhooks/", "/api/health"];
const COOKIE = "smartfuel_session";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length >= 32) return new TextEncoder().encode(secret);
  return new TextEncoder().encode("dev-only-insecure-secret-change-me-000000000000000000000000");
}

function readToken(request: Request): string | undefined {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(`${COOKIE}=`.length);
}

export async function middleware(request: Request) {
  const { pathname } = new URL(request.url);

  if (PUBLIC_PATHS.some((path) => pathname === path)) return NextResponse.next();

  const token = readToken(request);
  const valid = token ? await verify(token) : false;

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.some((path) => pathname.startsWith(path))) return NextResponse.next();
    if (!valid) {
      return NextResponse.json(
        { ok: false, error: { code: "unauthorized", message: "Your session has expired. Please sign in again." } },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  if (!valid) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    const response = NextResponse.redirect(url);
    if (token) response.cookies.delete(COOKIE);
    return response;
  }

  return NextResponse.next();
}

async function verify(token: string): Promise<boolean> {
  try {
    await jwtVerify(decodeURIComponent(token), getSecret(), { issuer: "smartfuel", audience: "smartfuel-web" });
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|woff2?)$).*)",
  ],
};
