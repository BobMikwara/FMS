import { REPORT_CATEGORIES } from "@/lib/report-categories";

export interface ScheduleDefinitionInput {
  name: string;
  category: string;
  period: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  format: "pdf" | "excel" | "csv";
  stationId: string | null;
  recipients: string[];
  isEnabled: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CATEGORIES = new Set(REPORT_CATEGORIES.map((entry) => entry.value));

export function validateScheduleDefinition(input: unknown):
  | { ok: true; value: ScheduleDefinitionInput }
  | { ok: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "A scheduled report definition is required." };
  }
  const value = input as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 120) return { ok: false, message: "Schedule name must be between 1 and 120 characters." };

  const category = typeof value.category === "string" ? value.category : "";
  if (!CATEGORIES.has(category)) return { ok: false, message: "Choose a supported report category." };

  const period = value.period;
  if (period !== "daily" && period !== "weekly" && period !== "monthly") {
    return { ok: false, message: "Schedule cadence must be daily, weekly, or monthly." };
  }
  const dayOfWeek = period === "weekly" ? value.dayOfWeek : null;
  if (period === "weekly" && (!Number.isInteger(dayOfWeek) || Number(dayOfWeek) < 0 || Number(dayOfWeek) > 6)) {
    return { ok: false, message: "Choose a weekday from Sunday through Saturday." };
  }
  const dayOfMonth = period === "monthly" ? value.dayOfMonth : null;
  if (period === "monthly" && (!Number.isInteger(dayOfMonth) || Number(dayOfMonth) < 1 || Number(dayOfMonth) > 31)) {
    return { ok: false, message: "Choose a month day from 1 through 31." };
  }

  const timeOfDay = typeof value.timeOfDay === "string" ? value.timeOfDay : "";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
    return { ok: false, message: "Schedule time must use the HH:MM 24-hour format." };
  }

  const format = value.format;
  if (format !== "pdf" && format !== "excel" && format !== "csv") {
    return { ok: false, message: "Choose PDF (print-ready HTML), Excel, or CSV as the output format." };
  }

  const stationId = value.stationId === null || value.stationId === "" || value.stationId === undefined
    ? null
    : typeof value.stationId === "string" ? value.stationId.trim() : null;
  if (value.stationId !== null && value.stationId !== undefined && value.stationId !== "" && !stationId) {
    return { ok: false, message: "Select a valid station or all stations." };
  }

  if (!Array.isArray(value.recipients)) return { ok: false, message: "Add at least one recipient email address." };
  const recipients = [...new Set(value.recipients
    .filter((email): email is string => typeof email === "string")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))];
  if (recipients.length === 0 || recipients.length > 10 || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    return { ok: false, message: "Enter 1 to 10 valid recipient email addresses." };
  }
  if (typeof value.isEnabled !== "undefined" && typeof value.isEnabled !== "boolean") {
    return { ok: false, message: "Enabled state must be true or false." };
  }

  return {
    ok: true,
    value: {
      name,
      category,
      period,
      dayOfWeek: period === "weekly" ? Number(dayOfWeek) : null,
      dayOfMonth: period === "monthly" ? Number(dayOfMonth) : null,
      timeOfDay,
      format,
      stationId,
      recipients,
      isEnabled: value.isEnabled !== false,
    },
  };
}
