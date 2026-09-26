import { getCurrentUser } from "@/server/auth/session";
import { jsonOk, withAuth } from "@/server/api/route";

export const GET = withAuth(async () => {
  const user = await getCurrentUser();
  return jsonOk({ user });
});
