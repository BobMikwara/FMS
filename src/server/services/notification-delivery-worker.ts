import { completeNotificationDelivery, claimNotificationDeliveries, failNotificationDelivery } from "../db/repo/deliveries";
import { emailDeliveryConfigured, sendNotificationEmail, sendReportEmail } from "../email/mailer";
import type { ClaimedDelivery } from "../db/repo/deliveries";

export function deliveryRetryDelayMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.min(10, attempt - 1));
}

function permanentDeliveryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not configured|unsupported delivery channel|invalid delivery payload/i.test(message);
}

async function deliver(delivery: ClaimedDelivery): Promise<void> {
  if (delivery.channel !== "email") {
    throw new Error(`Unsupported delivery channel: ${delivery.channel}`);
  }
  if (!emailDeliveryConfigured()) {
    throw new Error("SMTP is not configured for email delivery");
  }

  const payload = delivery.payload;
  if (typeof payload.filename === "string" && typeof payload.contentType === "string" && typeof payload.content === "string") {
    await sendReportEmail({
      to: delivery.recipient,
      subject: payload.subject,
      text: payload.text,
      filename: payload.filename,
      contentType: payload.contentType,
      content: payload.content,
    });
    return;
  }

  if (typeof payload.title !== "string" || typeof payload.body !== "string" || typeof payload.severity !== "string") {
    throw new Error("Invalid delivery payload");
  }
  await sendNotificationEmail({
    to: delivery.recipient,
    subject: payload.subject,
    title: payload.title,
    body: payload.body,
    severity: payload.severity,
  });
}

export async function processNotificationDeliveries(limit = 20): Promise<{ claimed: number; delivered: number; retrying: number; failed: number }> {
  if (!emailDeliveryConfigured()) return { claimed: 0, delivered: 0, retrying: 0, failed: 0 };
  const claimed = await claimNotificationDeliveries({ limit });
  const summary = { claimed: claimed.length, delivered: 0, retrying: 0, failed: 0 };
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(4, claimed.length) }, async () => {
    while (nextIndex < claimed.length) {
      const index = nextIndex++;
      const delivery = claimed[index];
      try {
        await deliver(delivery);
        await completeNotificationDelivery(delivery.id);
        summary.delivered += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Email provider returned an unknown error";
        const permanent = permanentDeliveryError(error);
        const canRetry = !permanent && delivery.attemptCount < delivery.maxAttempts;
        const retryAt = canRetry
          ? new Date(Date.now() + deliveryRetryDelayMs(delivery.attemptCount)).toISOString()
          : null;
        await failNotificationDelivery({ deliveryId: delivery.id, error: message, retryAt });
        if (canRetry) summary.retrying += 1;
        else summary.failed += 1;
      }
    }
  });
  await Promise.all(workers);
  return summary;
}
