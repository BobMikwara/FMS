import type { Device } from "@/server/domain/types";

/** Never serialize a device's stored credential hash to the browser or audit log. */
export function publicDevice<T extends Device>(device: T): Omit<T, "apiKeyHash"> {
  const { apiKeyHash: _apiKeyHash, ...safeDevice } = device;
  void _apiKeyHash;
  return safeDevice;
}
