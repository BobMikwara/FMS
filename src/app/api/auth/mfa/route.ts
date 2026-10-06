import { getUserMfaStatus } from "@/server/db/repo/security";
import { jsonOk, withAuth } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request, ctx) => {
  return jsonOk(await getUserMfaStatus(ctx.user.id));
});
