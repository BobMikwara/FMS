import type { Alert, User } from "../domain/types";
import { transaction } from "../db/client";
import { getAlertRule } from "../db/repo/alerts";
import { createNotification, listUsers } from "../db/repo/core";
import { createNotificationDelivery } from "../db/repo/deliveries";

function canViewNotifications(user: User): boolean {
  return user.permissions.includes("*") || user.permissions.includes("notifications.view") ||
    user.roleKey === "owner" || user.roleKey === "super_admin";
}

function canAccessStation(user: User, stationId: string): boolean {
  return user.roleKey === "admin" || user.roleKey === "owner" || user.roleKey === "super_admin" ||
    user.stationIds.includes(stationId);
}

export async function dispatchStationNotification(input: {
  organizationId: string;
  stationId: string;
  alertId?: string | null;
  idempotencyKey: string;
  title: string;
  body: string;
  severity: string;
  channels?: string[];
}): Promise<{ recipients: number; inApp: number; queuedEmail: number }> {
  return transaction(async () => {
    const recipients = (await listUsers(input.organizationId)).filter(
      (user) => user.status === "active" && canViewNotifications(user) && canAccessStation(user, input.stationId),
    );
    const channels = [...new Set((input.channels?.length ? input.channels : ["in_app"]).map((channel) => channel.trim().toLowerCase()))];
    let inApp = 0;
    let queuedEmail = 0;

    for (const user of recipients) {
      let notificationId: string | null = null;
      if (channels.includes("in_app")) {
        const notification = await createNotification({
          organizationId: input.organizationId,
          userId: user.id,
          alertId: input.alertId ?? null,
          title: input.title,
          body: input.body,
          severity: input.severity,
          channel: "in_app",
          idempotencyKey: `notification:${input.idempotencyKey}:${user.id}`,
        });
        notificationId = notification.id;
        await createNotificationDelivery({
          organizationId: input.organizationId,
          notificationId,
          userId: user.id,
          channel: "in_app",
          recipient: user.email,
          idempotencyKey: `in-app:${input.idempotencyKey}:${user.id}`,
          payload: { subject: input.title, title: input.title, body: input.body, text: input.body, severity: input.severity },
          status: "delivered",
        });
        inApp += 1;
      }

      if (channels.includes("email")) {
        const delivery = await createNotificationDelivery({
          organizationId: input.organizationId,
          notificationId,
          userId: user.id,
          channel: "email",
          recipient: user.email,
          idempotencyKey: `email:${input.idempotencyKey}:${user.id}`,
          payload: {
            subject: `${input.severity.toUpperCase()}: ${input.title}`,
            title: input.title,
            body: input.body,
            text: `${input.title}\n\n${input.body}`,
            severity: input.severity,
          },
        });
        if (delivery.status === "queued" || delivery.status === "sending") queuedEmail += 1;
      }

      for (const channel of channels.filter((value) => value !== "in_app" && value !== "email")) {
        await createNotificationDelivery({
          organizationId: input.organizationId,
          userId: user.id,
          channel,
          recipient: user.email,
          idempotencyKey: `${channel}:${input.idempotencyKey}:${user.id}`,
          payload: { subject: input.title, title: input.title, body: input.body, text: input.body, severity: input.severity },
          status: "failed",
          maxAttempts: 0,
          lastError: `The ${channel} delivery provider is not configured.`,
        });
      }
    }

    return { recipients: recipients.length, inApp, queuedEmail };
  });
}

export async function notifyAlert(alert: Alert): Promise<void> {
  const rule = alert.ruleId ? await getAlertRule(alert.ruleId) : null;
  const channels = rule && rule.organizationId === alert.organizationId ? rule.channels : ["in_app"];
  await dispatchStationNotification({
    organizationId: alert.organizationId,
    stationId: alert.stationId,
    alertId: alert.id,
    idempotencyKey: `alert:${alert.id}`,
    title: alert.title,
    body: alert.message,
    severity: alert.severity,
    channels,
  });
}
