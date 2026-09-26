/**
 * Report catalogue.
 *
 * Lives in `lib` rather than `server/services` so client components can list the
 * categories without pulling the data-access layer into the browser bundle.
 * `server/services/report-builder.ts` re-exports this for server callers.
 */

export interface ReportCategory {
  value: string;
  label: string;
  description: string;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  {
    value: "summary",
    label: "Executive summary",
    description: "One-page roll-up of stock, consumption, alerts and device health.",
  },
  {
    value: "consumption",
    label: "Fuel consumption / tank outflow",
    description: "Every detected outflow, with confidence and the device that reported it.",
  },
  { value: "refills", label: "Refills", description: "Every detected delivery, volume and duration." },
  {
    value: "movements",
    label: "Full movement ledger",
    description: "Consumption, refills and anomalies in one chronological ledger.",
  },
  { value: "inventory", label: "Inventory snapshot", description: "Current volume and level for every tank." },
  {
    value: "reconciliation",
    description: "Expected closing stock versus what the probe measured, per tank.",
    label: "Inventory reconciliation",
  },
  { value: "alerts", label: "Alerts", description: "Alerts raised, acknowledged and resolved in the period." },
  { value: "stations", label: "Station comparison", description: "Side-by-side station performance." },
  { value: "vehicles", label: "Vehicles", description: "Fleet list with tracker and driver assignment." },
  { value: "audit", label: "Audit log", description: "Every recorded action in the period." },
];

export function reportCategoryLabel(value: string): string {
  return REPORT_CATEGORIES.find((entry) => entry.value === value)?.label ?? value;
}
