import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------- */
/* Number / date formatting                                                   */
/* -------------------------------------------------------------------------- */

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", opts);

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Volume in liters, rendered as `38,420 L`. */
export function formatVolume(liters: number | null | undefined, digits = 0): string {
  if (liters == null || Number.isNaN(liters)) return "—";
  return `${nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(liters)} L`;
}

/** Compact volume for KPI tiles: `486.2k L`. */
export function formatCompactVolume(liters: number | null | undefined): string {
  if (liters == null || Number.isNaN(liters)) return "—";
  const abs = Math.abs(liters);
  if (abs >= 1_000_000) return `${(liters / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M L`;
  if (abs >= 10_000) return `${(liters / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k L`;
  return `${formatNumber(liters)} L`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 0): string {
  const formatted = formatNumber(Math.abs(value), digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

export function formatCurrency(value: number | null | undefined, currency = "TZS"): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${nf({ maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

export function formatTemperature(celsius: number | null | undefined): string {
  if (celsius == null || Number.isNaN(celsius)) return "—";
  return `${celsius.toFixed(1)} °C`;
}

export function formatDistance(km: number | null | undefined): string {
  if (km == null || Number.isNaN(km)) return "—";
  return `${nf({ maximumFractionDigits: 1 }).format(km)} km`;
}

/* -------------------------------------------------------------------------- */
/* Relative time                                                              */
/* -------------------------------------------------------------------------- */

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"} ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function formatHourLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Deterministic pseudo-random in [0,1) from a string — used for stable visuals. */
export function hashUnit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function startOfDayIso(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
