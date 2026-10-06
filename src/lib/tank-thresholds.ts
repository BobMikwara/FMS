export interface TankThresholds {
  criticalThresholdPct: number;
  lowThresholdPct: number;
  overfillThresholdPct: number;
}

export interface TankThresholdValidation {
  ok: boolean;
  errors: Partial<Record<keyof TankThresholds, string>>;
}

export function validateTankThresholds(value: TankThresholds): TankThresholdValidation {
  const errors: TankThresholdValidation["errors"] = {};

  if (!Number.isFinite(value.criticalThresholdPct) || value.criticalThresholdPct < 1 || value.criticalThresholdPct > 100) {
    errors.criticalThresholdPct = "Use a percentage between 1 and 100.";
  }
  if (!Number.isFinite(value.lowThresholdPct) || value.lowThresholdPct < 1 || value.lowThresholdPct > 100) {
    errors.lowThresholdPct = "Use a percentage between 1 and 100.";
  }
  if (!Number.isFinite(value.overfillThresholdPct) || value.overfillThresholdPct < 50 || value.overfillThresholdPct > 100) {
    errors.overfillThresholdPct = "Use a percentage between 50 and 100.";
  }

  if (
    errors.criticalThresholdPct === undefined &&
    errors.lowThresholdPct === undefined &&
    value.criticalThresholdPct >= value.lowThresholdPct
  ) {
    errors.criticalThresholdPct = "The critical threshold must be below the low threshold.";
  }
  if (
    errors.lowThresholdPct === undefined &&
    errors.overfillThresholdPct === undefined &&
    value.lowThresholdPct >= value.overfillThresholdPct
  ) {
    errors.overfillThresholdPct = "The overfill threshold must be above the low threshold.";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
