import { clearSessionCookie } from "@/server/auth/session";
import { jsonOk } from "@/server/api/route";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ signedOut: true });
}
