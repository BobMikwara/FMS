import { ingestReading } from "@/server/engine/fuel";
import { hashDeviceKey, verifyDeviceKey } from "@/server/auth/session";
import { getProvider } from "@/server/integrations/providers";
import { getDeviceByApiKeyHash } from "@/server/db/repo/devices";
import { conflict, forbidden, jsonError, jsonOk, notFound, unauthorized, unprocessable } from "@/server/api/route";

export const dynamic = "force-dynamic";

/**
 * Device Integration Layer entry point (PRD §57, §62).
 *
 * POST /api/webhooks/device/:provider
 *
 * 1. The device authenticates with its per-device API key (`x-api-key` or
 *    `Authorization: Bearer <key>`). Keys are stored hashed.
 * 2. The registered provider adapter (`normalize()`) translates the vendor
 *    payload into the platform's `NormalizedReading` shape — the rest of the
 *    application never sees vendor-specific field names.
 * 3. The ingestion engine validates the reading against the tank, classifies
 *    movement, stores the raw reading and evaluates alert rules.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await params;

    const providerAdapter = getProvider(provider);
    if (!providerAdapter) {
      return jsonError(notFound(`Unknown device provider "${provider}".`));
    }

    const rawBody = await request.text();

    // 1. Device authentication.
    const apiKey =
      request.headers.get("x-api-key") ??
      request.headers.get("x-device-key") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (!apiKey) {
      return jsonError(unauthorized("A device API key is required (x-api-key header)."));
    }
    const hashed = hashDeviceKey(apiKey);
    const device = (await getDeviceByApiKeyHash(hashed));
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
      return jsonError(forbidden("This device has been deactivated and can no longer submit readings."));
    }

    // 2. Vendor payload → normalized reading.
    let payload: Record<string, unknown>;
    try {
      payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      return jsonError(unprocessable("Request body must be valid JSON."));
    }
    let normalized;
    try {
      normalized = providerAdapter.normalize(payload);
    } catch (error) {
      // A malformed vendor payload is the sender's problem, not a server fault.
      return jsonError(
        unprocessable(
          `The ${providerAdapter.name} payload could not be read: ${error instanceof Error ? error.message : "unexpected shape"}.`,
        ),
      );
    }
    if (!normalized) {
      return jsonError(
        unprocessable(
          `The ${providerAdapter.name} payload could not be normalised into a reading — no volume field was found.`,
        ),
      );
    }

    // 3. Validate, classify and store.
    const result = (await ingestReading({ deviceSerial: device.serialNumber, reading: normalized }));
    if (!result.ok) {
      // A rejected reading is a 422 (or 409 when the device is misconfigured),
      // never a 500 — the device did its job, the payload was the problem.
      const status =
        result.rejected === "unknown_device" || result.rejected === "unassigned_device" ? 409 : 422;
      return jsonError(
        status === 409
          ? conflict(result.message ?? "The device is not configured for ingestion.")
          : unprocessable(result.message ?? "The reading was rejected."),
      );
    }
    return jsonOk(result);
  } catch (error) {
    return jsonError(error as Error, request);
  }
}
