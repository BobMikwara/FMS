export const SUPPORTED_ALERT_RULE_TYPES = [
  "low_fuel",
  "critical_fuel",
  "refill",
  "invalid_reading",
  "high_fuel",
  "overfill",
  "water_detected",
  "high_temperature",
  "temperature_abnormal",
  "probe_offline",
  "gps_offline",
  "rapid_change",
  "suspected_loss",
  "reconciliation_variance",
] as const;

export type SupportedAlertRuleType = (typeof SUPPORTED_ALERT_RULE_TYPES)[number];

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

const THRESHOLD_FIELDS: Record<SupportedAlertRuleType, { keys: string[]; min: number; max: number }> = {
  low_fuel: { keys: ["percent", "value"], min: 0, max: 105 },
  critical_fuel: { keys: ["percent", "value"], min: 0, max: 105 },
  refill: { keys: ["liters", "volumeLiters", "value"], min: 0, max: 5_000_000 },
  invalid_reading: { keys: [], min: 0, max: 0 },
  high_fuel: { keys: ["percent", "value"], min: 0, max: 105 },
  overfill: { keys: ["percent", "value"], min: 0, max: 105 },
  water_detected: { keys: ["mm", "value"], min: 0, max: 100_000 },
  high_temperature: { keys: ["celsius", "value"], min: -40, max: 90 },
  temperature_abnormal: { keys: ["celsius", "value"], min: -40, max: 90 },
  probe_offline: { keys: ["minutes", "value"], min: 1, max: 10_080 },
  gps_offline: { keys: ["minutes", "value"], min: 1, max: 10_080 },
  rapid_change: { keys: ["litersPerMinute", "ratePerMinute", "value"], min: 0.01, max: 1_000_000 },
  suspected_loss: { keys: ["liters", "dropLiters", "litersPerMinute", "ratePerMinute", "value"], min: 0, max: 5_000_000 },
  reconciliation_variance: { keys: ["percent", "value"], min: 0, max: 100 },
};

export function validateAlertRuleConfig(input: {
  type: string;
  condition: unknown;
  severity: string;
  cooldownMin: number;
}): string | null {
  if (!(SUPPORTED_ALERT_RULE_TYPES as readonly string[]).includes(input.type)) {
    return "Select a supported alert-rule condition.";
  }
  if (!(input.severity === "critical" || input.severity === "warning" || input.severity === "info")) {
    return "Select a supported alert severity.";
  }
  if (!Number.isInteger(input.cooldownMin) || input.cooldownMin < 0 || input.cooldownMin > 10_080) {
    return "Cooldown must be a whole number between 0 and 10,080 minutes.";
  }
  if (!input.condition || typeof input.condition !== "object" || Array.isArray(input.condition)) {
    return "Rule condition must be a JSON object.";
  }

  const condition = input.condition as Record<string, unknown>;
  const ruleType = input.type as SupportedAlertRuleType;
  const config = THRESHOLD_FIELDS[ruleType];
  const hasLegacyDropRate = ruleType === "suspected_loss" && condition.metric === "drop_rate";
  const legacyTemperatureRange = ruleType === "temperature_abnormal" &&
    condition.metric === "temperature_c" && condition.operator === "outside";
  const acceptedKeys = new Set([...config.keys, "metric", "operator"]);
  if (ruleType === "rapid_change" || ruleType === "suspected_loss") acceptedKeys.add("windowMinutes");
  if (ruleType === "suspected_loss") acceptedKeys.add("sensitivity");
  if (ruleType === "invalid_reading") {
    if (condition.metric !== "validation" || condition.operator !== "fails") {
      return "Invalid-reading rules must use the validation-fails condition.";
    }
    if (Object.keys(condition).some((key) => key !== "metric" && key !== "operator")) {
      return "Invalid-reading rules only support the validation-fails condition.";
    }
    return null;
  }
  const thresholdEntries = Object.entries(condition).filter(([key]) => config.keys.includes(key));
  if (legacyTemperatureRange) {
    if (!Array.isArray(condition.value) || condition.value.length !== 2) {
      return "A temperature range must contain a minimum and maximum value.";
    }
    const minimum = finiteNumber(condition.value[0]);
    const maximum = finiteNumber(condition.value[1]);
    if (minimum == null || maximum == null || minimum < -40 || maximum > 90 || minimum >= maximum) {
      return "Temperature range must be ordered within -40 to 90 degrees Celsius.";
    }
  } else if (thresholdEntries.length === 0) {
    return "Enter a numeric threshold for this alert condition.";
  }
  for (const [key, raw] of (legacyTemperatureRange ? [] : thresholdEntries)) {
    const value = finiteNumber(raw);
    if (value == null) return `The ${key} threshold must be a finite number.`;
    const minimum = ruleType === "suspected_loss" && hasLegacyDropRate && key === "value" ? 0 : config.min;
    const maximum = ruleType === "suspected_loss" && hasLegacyDropRate && key === "value" ? 1_000_000 : config.max;
    if (value < minimum || value > maximum) {
      return `The ${key} threshold must be between ${minimum} and ${maximum}.`;
    }
  }
  const unsupported = Object.keys(condition).filter((key) => !acceptedKeys.has(key));
  if (unsupported.length > 0) return `Unsupported condition field: ${unsupported[0]}.`;
  if (condition.windowMinutes != null) {
    const windowMinutes = finiteNumber(condition.windowMinutes);
    if (windowMinutes == null || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 10_080) {
      return "The condition window must be a whole number between 1 and 10,080 minutes.";
    }
  }
  if (condition.sensitivity != null && !["low", "medium", "high"].includes(String(condition.sensitivity))) {
    return "Sensitivity must be low, medium, or high.";
  }
  if (condition.metric != null && typeof condition.metric !== "string") {
    return "Condition metric must be text.";
  }
  const allowedOperators: Record<SupportedAlertRuleType, string[]> = {
    low_fuel: ["<", "<="],
    critical_fuel: ["<", "<="],
    refill: [">", ">="],
    invalid_reading: [],
    high_fuel: [">", ">="],
    overfill: [">", ">="],
    water_detected: [">", ">="],
    high_temperature: [">", ">="],
    temperature_abnormal: legacyTemperatureRange ? ["outside"] : [],
    probe_offline: [">", ">="],
    gps_offline: [">", ">="],
    rapid_change: [">", ">="],
    suspected_loss: [">", ">="],
    reconciliation_variance: [">", ">="],
  };
  if (condition.operator != null && !allowedOperators[ruleType].includes(String(condition.operator))) {
    return "Condition operator is not supported for this alert type.";
  }
  return null;
}
