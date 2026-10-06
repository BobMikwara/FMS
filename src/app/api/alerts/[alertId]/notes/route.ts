import { userCanAccessStation } from "@/server/auth/authorization";
import { addAlertNote, getAlert, listAlertNotes } from "@/server/db/repo/alerts";
import { audit, jsonCreated, jsonError, jsonOk, maxLen, notFound, parseJsonBody, required, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

export const GET = withPermission("alerts.view", async (request, ctx) => {
  try {
    const alertId = ctx.params?.alertId ?? "";
    const alert = await getAlert(alertId);
    if (
      !alert ||
      alert.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, alert.stationId)
    ) {
      return jsonError(notFound("Alert not found."), request);
    }
    return jsonOk({ notes: await listAlertNotes(alertId) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});

export const POST = withPermission("alerts.notes", async (request, ctx) => {
  try {
    const alertId = ctx.params?.alertId ?? "";
    const alert = await getAlert(alertId);
    if (
      !alert ||
      alert.organizationId !== ctx.user.organizationId ||
      !userCanAccessStation(ctx.user, alert.stationId)
    ) {
      return jsonError(notFound("Alert not found."), request);
    }
    const body = await parseJsonBody<{ body?: string }>(request);
    const text = maxLen(required(body.body, "Note"), 2000, "Note");
    (await addAlertNote(alertId, ctx.user.id, text));
    (await audit({
      user: ctx.user,
      action: "created",
      entity: "alert_note",
      entityId: alertId,
      entityLabel: `Note on ${alertId}`,
      summary: `${ctx.user.name} added a note to alert ${alertId}`,
      next: { body: text },
      request,
    }));
    return jsonCreated({ notes: (await listAlertNotes(alertId)) });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
