"use client";

import { Field, Input } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { USAGE_PRESETS, type UsagePreset } from "@/lib/tank-usage";

export interface UsageSelection {
  preset: UsagePreset;
  /** Local `YYYY-MM-DD`; kept while another preset is chosen so Custom Date remembers it. */
  start: string;
  end: string;
}

/**
 * The one control that sets the period for the whole Usage view: the preset
 * buttons and, for Custom Date, a start and an end date picker. It only edits
 * the selection; the view reads that single value.
 */
export function UsageRangeSelector({
  value,
  onChange,
  maxDate,
  error,
}: {
  value: UsageSelection;
  onChange: (next: UsageSelection) => void;
  /** Latest selectable day (today in the tank's time zone). */
  maxDate: string;
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      <SegmentedControl
        ariaLabel="Usage period"
        options={USAGE_PRESETS}
        value={value.preset}
        onChange={(preset) => onChange({ ...value, preset })}
      />
      {value.preset === "custom" ? (
        <div className="grid max-w-lg gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field label="Start date" htmlFor="usage-start">
            <Input
              id="usage-start"
              type="date"
              value={value.start}
              max={maxDate}
              invalid={Boolean(error)}
              onChange={(event) => onChange({ ...value, start: event.target.value })}
            />
          </Field>
          <Field label="End date" htmlFor="usage-end">
            <Input
              id="usage-end"
              type="date"
              value={value.end}
              min={value.start || undefined}
              max={maxDate}
              invalid={Boolean(error)}
              onChange={(event) => onChange({ ...value, end: event.target.value })}
            />
          </Field>
          {error ? (
            <p className="field-error sm:col-span-2" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
