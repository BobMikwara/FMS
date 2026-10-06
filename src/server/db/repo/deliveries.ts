import { execute, id, isPostgres, query, queryOne, toIso, transaction } from "../client";
import type { DeliveryStatus, NotificationDelivery } from "../../domain/types";

export interface DeliveryPayload {
  subject: string;
  text: string;
  title?: string;
  body?: string;
  severity?: string;
  reportId?: string;
  format?: string;
  [key: string]: unknown;
}

export interface ClaimedDelivery extends NotificationDelivery {
  payload: DeliveryPayload;
}

export async function createNotificationDelivery(input: {
  organizationId: string;
  notificationId?: string | null;
  scheduledReportRunId?: string | null;
  userId?: string | null;
  channel: string;
  recipient: string;
  idempotencyKey: string;
  payload: DeliveryPayload;
  status?: DeliveryStatus;
  maxAttempts?: number;
  lastError?: string | null;
}): Promise<NotificationDelivery> {
  const deliveryId = id("dlv");
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO notification_deliveries (
       id, organization_id, notification_id, scheduled_report_run_id, user_id,
       channel, recipient, idempotency_key, payload, status, attempt_count,
       max_attempts, next_attempt_at, delivered_at, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      deliveryId,
      input.organizationId,
      input.notificationId ?? null,
      input.scheduledReportRunId ?? null,
      input.userId ?? null,
      input.channel,
      input.recipient,
      input.idempotencyKey,
      JSON.stringify(input.payload),
      input.status ?? "queued",
      input.maxAttempts ?? 5,
      input.status === "delivered" ? now : null,
      input.lastError ?? null,
      now,
      now,
    ],
  );
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM notification_deliveries WHERE idempotency_key = ?",
    [input.idempotencyKey],
  );
  if (!row) throw new Error("Could not verify the notification delivery record");
  return mapDelivery(row);
}

export async function listUserNotificationDeliveries(
  organizationId: string,
  userId: string,
  limit = 30,
): Promise<NotificationDelivery[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM notification_deliveries
     WHERE organization_id = ? AND user_id = ?
     ORDER BY created_at DESC LIMIT ?`,
    [organizationId, userId, Math.min(100, Math.max(1, Math.floor(limit)))],
  );
  return rows.map(mapDelivery);
}

export async function claimNotificationDeliveries(input: {
  limit?: number;
  now?: string;
  staleBefore?: string;
} = {}): Promise<ClaimedDelivery[]> {
  const now = input.now ?? new Date().toISOString();
  const staleBefore = input.staleBefore ?? new Date(Date.now() - 10 * 60_000).toISOString();
  const limit = Math.min(50, Math.max(1, Math.floor(input.limit ?? 20)));
  return transaction(async () => {
    await execute(
      `UPDATE notification_deliveries
       SET status = 'failed', next_attempt_at = NULL,
           last_error = COALESCE(last_error, 'Delivery worker stopped before completion'), updated_at = ?
       WHERE status = 'sending' AND updated_at <= ? AND attempt_count >= max_attempts`,
      [now, staleBefore],
    );
    const lock = isPostgres() ? " FOR UPDATE SKIP LOCKED" : "";
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM notification_deliveries
       WHERE attempt_count < max_attempts AND (
         (status IN ('queued', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         OR (status = 'sending' AND updated_at <= ?)
       )
       ORDER BY created_at ASC LIMIT ?${lock}`,
      [now, staleBefore, limit],
    );
    const claimed: ClaimedDelivery[] = [];
    for (const row of rows) {
      const deliveryId = String(row.id);
      await execute(
        `UPDATE notification_deliveries
         SET status = 'sending', attempt_count = attempt_count + 1, next_attempt_at = NULL, updated_at = ?
         WHERE id = ?`,
        [now, deliveryId],
      );
      const updated = await queryOne<Record<string, unknown>>(
        "SELECT * FROM notification_deliveries WHERE id = ?",
        [deliveryId],
      );
      if (updated) claimed.push(mapClaimedDelivery(updated));
    }
    return claimed;
  });
}

export async function completeNotificationDelivery(deliveryId: string, deliveredAt = new Date().toISOString()): Promise<void> {
  await execute(
    `UPDATE notification_deliveries
     SET status = 'delivered', delivered_at = ?, next_attempt_at = NULL, last_error = NULL, updated_at = ?
     WHERE id = ? AND status = 'sending'`,
    [deliveredAt, deliveredAt, deliveryId],
  );
}

export async function failNotificationDelivery(input: {
  deliveryId: string;
  error: string;
  retryAt?: string | null;
}): Promise<void> {
  const row = await queryOne<{ attempt_count: number; max_attempts: number }>(
    "SELECT attempt_count, max_attempts FROM notification_deliveries WHERE id = ?",
    [input.deliveryId],
  );
  if (!row) return;
  const retry = input.retryAt != null && Number(row.attempt_count) < Number(row.max_attempts);
  const now = new Date().toISOString();
  const error = input.error.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500) || "Delivery failed";
  await execute(
    `UPDATE notification_deliveries
     SET status = ?, attempt_count = CASE WHEN ? = 1 THEN attempt_count ELSE max_attempts END,
         next_attempt_at = ?, last_error = ?, updated_at = ?
     WHERE id = ? AND status = 'sending'`,
    [retry ? "queued" : "failed", retry ? 1 : 0, retry ? input.retryAt : null, error, now, input.deliveryId],
  );
}

export async function getNotificationDelivery(deliveryId: string): Promise<NotificationDelivery | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM notification_deliveries WHERE id = ?",
    [deliveryId],
  );
  return row ? mapDelivery(row) : null;
}

function mapDelivery(row: Record<string, unknown>): NotificationDelivery {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    notificationId: row.notification_id == null ? null : String(row.notification_id),
    scheduledReportRunId: row.scheduled_report_run_id == null ? null : String(row.scheduled_report_run_id),
    userId: row.user_id == null ? null : String(row.user_id),
    channel: String(row.channel),
    recipient: String(row.recipient),
    status: String(row.status) as DeliveryStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    nextAttemptAt: toIso(row.next_attempt_at),
    deliveredAt: toIso(row.delivered_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    createdAt: toIso(row.created_at) ?? String(row.created_at),
    updatedAt: toIso(row.updated_at) ?? String(row.updated_at),
  };
}

function mapClaimedDelivery(row: Record<string, unknown>): ClaimedDelivery {
  let payload: DeliveryPayload = { subject: "SmartFuel notification", text: "" };
  if (typeof row.payload === "string") {
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as DeliveryPayload;
    } catch {
      payload = { subject: "SmartFuel notification", text: "" };
    }
  }
  return { ...mapDelivery(row), payload };
}
