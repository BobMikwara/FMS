import { addAlertNote, listAlertNotes } from "@/server/db/repo/alerts";
import { audit, jsonCreated, jsonError, jsonOk, maxLen, parseJsonBody, required, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alerts.view", async (request, ctx) => {
  try {
    const alertId = ctx.params?.alertId ?? "";
    return jsonOk({ notes: listAlertNotes(alertId) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("alerts.acknowledge", async (request, ctx) => {
  try {
    const alertId = ctx.params?.alertId ?? "";
    const body = await parseJsonBody<{ body?: string }>(request);
    const text = maxLen(required(body.body, "Note"), 2000, "Note");
    addAlertNote(alertId, ctx.user.id, text);
    audit({
      user: ctx.user,
      action: "created",
      entity: "alert_note",
      entityId: alertId,
      entityLabel: `Note on ${alertId}`,
      summary: `${ctx.user.name} added a note to alert ${alertId}`,
      next: { body: text },
      request,
    });
    return jsonCreated({ notes: listAlertNotes(alertId) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
