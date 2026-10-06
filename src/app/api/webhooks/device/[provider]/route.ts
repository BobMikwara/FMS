import { flagInvalidTelemetry, ingestReading } from "@/server/engine/fuel";
import { hashDeviceKey, verifyDeviceKey } from "@/server/auth/session";
import { getProvider } from "@/server/integrations/providers";
import { getDeviceByApiKeyHash } from "@/server/db/repo/devices";
import { ingestVehiclePosition } from "@/server/services/vehicle-telemetry";
import { scheduleMaintenanceSweep } from "@/server/services/maintenance-sweep";
import { ApiError, conflict, forbidden, jsonError, jsonOk, notFound, unauthorized, unprocessable } from "@/server/api/route";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_BYTES = 1_048_576;

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new ApiError(413, "Device payload exceeds the 1 MiB limit.", "payload_too_large");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "Device payload exceeds the 1 MiB limit.", "payload_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Device Integration Layer entry point.
 *
 * Fuel probes write only to the tank-reading engine. GPS trackers write only to
 * the vehicle-position model; they are never normalized as fuel readings.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;
    const providerAdapter = getProvider(provider);
    if (!providerAdapter) return jsonError(notFound(`Unknown device provider "${provider}".`));

    const rawBody = await readBoundedBody(request);
    const apiKey =
      request.headers.get("x-api-key") ??
      request.headers.get("x-device-key") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (!apiKey) return jsonError(unauthorized("A device API key is required (x-api-key header)."));

    const device = await getDeviceByApiKeyHash(hashDeviceKey(apiKey));
    if (!device || !verifyDeviceKey(apiKey, device.apiKeyHash)) {
      return jsonError(unauthorized("Device credentials were rejected."));
    }
    if (device.provider !== provider) {
      return jsonError(unauthorized("The device is registered with a different provider adapter."));
    }
    if (providerAdapter.authMethod === "hmac" && !providerAdapter.verify(request, rawBody, apiKey)) {
      return jsonError(unauthorized("The provider signature was missing or invalid."));
    }
    if (!device.isActive) {
      return jsonError(forbidden("This device has been deactivated and can no longer submit telemetry."));
    }
    if ((providerAdapter.kind === "gps") !== (device.type === "gps_tracker")) {
      return jsonError(conflict("The device type does not match this provider's telemetry class."));
    }

    // Telemetry is the strongest signal that a fleet is live, so it also keeps the
    // device-health sweep warm between the daily Cron runs. Scheduled before
    // parsing so both the GPS and fuel-probe success paths are covered; it runs
    // after this response, once the reading has committed.
    scheduleMaintenanceSweep("device-telemetry");

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
      payload = parsed as Record<string, unknown>;
    } catch {
      if (device.type === "fuel_probe") await flagInvalidTelemetry(device.id, "Request body must be valid JSON");
      return jsonError(unprocessable("Request body must be a valid JSON object."), request);
    }

    if (providerAdapter.kind === "gps") {
      const normalized = providerAdapter.normalizePosition?.(payload) ?? null;
      if (!normalized) {
        return jsonError(
          unprocessable(`The ${providerAdapter.name} payload did not contain a valid GPS position.`),
          request,
        );
      }
      const result = await ingestVehiclePosition(device.id, normalized);
      if (!result.ok) {
        const status = result.rejected === "unknown_device" ? 404
          : result.rejected === "invalid_position" ? 422
            : 409;
        return jsonError(
          status === 409
            ? conflict(result.message)
            : status === 404
              ? notFound(result.message)
              : unprocessable(result.message),
          request,
        );
      }
      return jsonOk(result);
    }

    let normalized;
    try {
      normalized = providerAdapter.normalize(payload);
    } catch (error) {
      const reason = `Provider normalization failed: ${error instanceof Error ? error.message : "unexpected shape"}`;
      await flagInvalidTelemetry(device.id, reason);
      return jsonError(
        unprocessable(`The ${providerAdapter.name} payload could not be read: ${error instanceof Error ? error.message : "unexpected shape"}.`),
        request,
      );
    }
    if (!normalized) {
      await flagInvalidTelemetry(device.id, "No volume field was found in the payload");
      return jsonError(
        unprocessable(`The ${providerAdapter.name} payload could not be normalized into a reading: no volume field was found.`),
        request,
      );
    }

    const result = await ingestReading({ deviceId: device.id, reading: normalized });
    if (!result.ok) {
      const status =
        result.rejected === "unknown_device" ||
        result.rejected === "unassigned_device" ||
        result.rejected === "inactive_device" ||
        result.rejected === "duplicate"
          ? 409
          : 422;
      return jsonError(
        status === 409
          ? conflict(result.message ?? "The device is not configured for ingestion.")
          : unprocessable(result.message ?? "The reading was rejected."),
        request,
      );
    }
    return jsonOk(result);
  } catch (error) {
    return jsonError(error as Error, request);
  }
}
