export interface OperatorSettings {
  /** Retained for compatibility, but no automatic reading deletion is performed. */
  retentionDays: number;
  readingIntervalSec: number;
  offlineTimeoutMin: number;
  reconciliationVariancePct: number;
}

export const DEFAULT_OPERATOR_SETTINGS: OperatorSettings = {
  retentionDays: 365,
  readingIntervalSec: 60,
  offlineTimeoutMin: 10,
  reconciliationVariancePct: 0.5,
};

export interface OperationalEngineSettings {
  readingIntervalSec: number;
  deviceDelayedSeconds: number;
  deviceOfflineMinutes: number;
  reconciliationVariancePct: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    return fallback;
  }
  return value;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = finiteNumber(value, fallback, minimum, maximum);
  return Number.isInteger(candidate) ? candidate : fallback;
}

export function resolveOperatorSettings(settings: Record<string, unknown>): OperatorSettings {
  const system = asRecord(settings.system);
  const legacyEngine = asRecord(settings.engine);
  const legacyOffline = finiteNumber(
    legacyEngine.deviceOfflineMinutes,
    DEFAULT_OPERATOR_SETTINGS.offlineTimeoutMin,
    1,
    240,
  );
  const legacyVariance = finiteNumber(
    legacyEngine.reconciliationVariancePct,
    DEFAULT_OPERATOR_SETTINGS.reconciliationVariancePct,
    0.1,
    20,
  );

  return {
    retentionDays: integer(system.retentionDays, DEFAULT_OPERATOR_SETTINGS.retentionDays, 7, 3650),
    readingIntervalSec: integer(
      system.readingIntervalSec,
      DEFAULT_OPERATOR_SETTINGS.readingIntervalSec,
      10,
      3600,
    ),
    offlineTimeoutMin: integer(system.offlineTimeoutMin, legacyOffline, 1, 240),
    reconciliationVariancePct: finiteNumber(
      system.reconciliationVariancePct,
      legacyVariance,
      0.1,
      20,
    ),
  };
}

export function resolveOperationalEngineSettings(
  settings: Record<string, unknown>,
): OperationalEngineSettings {
  const operator = resolveOperatorSettings(settings);
  return {
    readingIntervalSec: operator.readingIntervalSec,
    deviceDelayedSeconds: Math.max(1, Math.ceil(operator.readingIntervalSec * 1.5)),
    deviceOfflineMinutes: operator.offlineTimeoutMin,
    reconciliationVariancePct: operator.reconciliationVariancePct,
  };
}

export type OperationalSettingsPatch = Partial<Pick<
  OperatorSettings,
  "readingIntervalSec" | "offlineTimeoutMin" | "reconciliationVariancePct"
>>;

export function validateOperationalSettingsPatch(
  input: unknown,
): { ok: true; value: OperationalSettingsPatch } | { ok: false; message: string } {
  const value = asRecord(input);
  const patch: OperationalSettingsPatch = {};

  if ("readingIntervalSec" in value) {
    const interval = value.readingIntervalSec;
    if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 10 || interval > 3600) {
      return { ok: false, message: "Expected reading interval must be a whole number from 10 to 3600 seconds." };
    }
    patch.readingIntervalSec = interval;
  }

  if ("offlineTimeoutMin" in value) {
    const timeout = value.offlineTimeoutMin;
    if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > 240) {
      return { ok: false, message: "Offline timeout must be a whole number from 1 to 240 minutes." };
    }
    patch.offlineTimeoutMin = timeout;
  }

  if ("reconciliationVariancePct" in value) {
    const threshold = value.reconciliationVariancePct;
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0.1 || threshold > 20) {
      return { ok: false, message: "Reconciliation variance must be from 0.1 to 20 percent." };
    }
    patch.reconciliationVariancePct = threshold;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: "Provide a supported system setting to update." };
  }

  return { ok: true, value: patch };
}
