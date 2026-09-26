"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Status vocabulary                                                          */
/* -------------------------------------------------------------------------- */

export type { StatusTone } from "@/lib/status";
import type { StatusTone } from "@/lib/status";

const toneClass: Record<StatusTone, string> = {
  ok: "badge-ok",
  warn: "badge-warn",
  brown: "badge-brown",
  crit: "badge-crit",
  info: "badge-info",
  idle: "badge-idle",
  neutral: "badge-neutral",
};

const dotColor: Record<StatusTone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  brown: "var(--tank-low)",
  crit: "var(--crit)",
  info: "var(--info)",
  idle: "var(--idle)",
  neutral: "var(--ink-3)",
};

export interface BadgeProps {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  title?: string;
}

export function Badge({ tone = "neutral", children, className, icon, title }: BadgeProps) {
  return (
    <span className={cn("badge", toneClass[tone], className)} title={title}>
      {icon}
      {children}
    </span>
  );
}

export interface StatusDotProps {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
  label?: string;
}

export function StatusDot({ tone, pulse, className, label }: StatusDotProps) {
  return (
    <span
      className={cn("dot", pulse && "dot-pulse", className)}
      style={{ background: dotColor[tone] }}
      role={label ? "img" : undefined}
      aria-label={label}
      title={label}
    />
  );
}

/** Status chip that always pairs colour with text - never colour alone. */
export function StatusBadge({
  tone,
  children,
  dot = true,
  pulse,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("badge", toneClass[tone], className)}>
      {dot ? <StatusDot tone={tone} pulse={pulse} /> : null}
      {children}
    </span>
  );
}


/* -------------------------------------------------------------------------- */
/* Status vocabulary helpers                                                  */
/* -------------------------------------------------------------------------- */

// The pure status mappings live in `src/lib/status.ts` so server components can
// use them too. Re-exported here for component-local convenience.
export {
  alertSeverityLabel,
  alertSeverityTone,
  alertStatusLabel,
  alertStatusTone,
  confidenceTone,
  dataStateLabel,
  dataStateTone,
  deviceStatusLabel,
  deviceStatusTone,
  eventTypeLabel,
  eventTypeTone,
  stationStatusLabel,
  stationStatusTone,
  tankStateForPercent,
  tankStatusLabel,
  tankStatusTone,
  vehicleStatusLabel,
  vehicleStatusTone,
  type AlertSeverity,
  type AlertStatus,
  type DataState,
  type DeviceStatus,
  type StationStatus,
  type TankStatus,
  type VehicleStatus,
} from "@/lib/status";

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("card card-pad", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-7 w-32" />
      <Skeleton className="mt-3 h-3 w-20" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-3)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error state                                                                */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  children?: React.ReactNode;
}

export function ErrorState({
  title = "Unable to load this data",
  message = "The monitoring service is temporarily unavailable. Your data is safe - please try again.",
  onRetry,
  retryLabel = "Try again",
  className,
  children,
}: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)} role="alert">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--crit)] bg-[var(--crit-soft)] text-[var(--crit)]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{message}</p>
      {onRetry || children ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                     */
/* -------------------------------------------------------------------------- */

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "ok" | "crit" | "warn" | "info";
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warn: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.duration ?? 4800);
    },
    [dismiss],
  );

  const success = useCallback(
    (title: string, description?: string) => push({ title, description, tone: "ok" }),
    [push],
  );
  const error = useCallback(
    (title: string, description?: string) => push({ title, description, tone: "crit", duration: 6000 }),
    [push],
  );
  const info = useCallback((title: string, description?: string) => push({ title, description, tone: "info" }), [push]);
  const warn = useCallback(
    (title: string, description?: string) => push({ title, description, tone: "warn", duration: 6000 }),
    [push],
  );

  const value = useMemo(
    () => ({ toasts, push, dismiss, success, error, info, warn }),
    [toasts, push, dismiss, success, error, info, warn],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="anim-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-pop)]"
        >
          <span
            className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full"
            style={{
              background:
                toast.tone === "ok"
                  ? "var(--ok-soft)"
                  : toast.tone === "crit"
                    ? "var(--crit-soft)"
                    : toast.tone === "warn"
                      ? "var(--warn-soft)"
                      : "var(--info-soft)",
              color:
                toast.tone === "ok"
                  ? "var(--ok)"
                  : toast.tone === "crit"
                    ? "var(--crit)"
                    : toast.tone === "warn"
                      ? "var(--warn)"
                      : "var(--info)",
            }}
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
              {toast.tone === "ok" ? (
                <path d="M6.2 11.4 3.3 8.5l1.1-1.1 1.8 1.8 5-5 1.1 1.1z" />
              ) : (
                <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7.25 4.5h1.5v5h-1.5v-5zm0 6h1.5v1.5h-1.5V10.5z" />
              )}
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-semibold text-[var(--ink)]">{toast.title}</p>
            {toast.description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{toast.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="flex-none rounded p-1 text-[var(--ink-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            aria-label="Dismiss notification"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live indicator                                                             */
/* -------------------------------------------------------------------------- */

export function LiveIndicator({
  state,
  ageLabel,
  className,
}: {
  state: "live" | "delayed" | "stale" | "offline";
  ageLabel?: string;
  className?: string;
}) {
  const config = {
    live: { tone: "ok" as StatusTone, label: "Live", pulse: true },
    delayed: { tone: "info" as StatusTone, label: "Delayed", pulse: false },
    stale: { tone: "warn" as StatusTone, label: "Stale data", pulse: false },
    offline: { tone: "crit" as StatusTone, label: "Offline", pulse: false },
  }[state];
  return (
    <span className={cn("badge", toneClass[config.tone], className)} title={ageLabel}>
      <StatusDot tone={config.tone} pulse={config.pulse} />
      {config.label}
      {ageLabel ? <span className="font-normal opacity-80">· {ageLabel}</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

export function ProgressBar({
  value,
  tone = "brand",
  className,
  showLabel,
  label,
}: {
  value: number;
  tone?: "brand" | "ok" | "warn" | "crit" | "info";
  className?: string;
  showLabel?: boolean;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    tone === "brand"
      ? "var(--brand)"
      : tone === "ok"
        ? "var(--ok)"
        : tone === "warn"
          ? "var(--warn)"
          : tone === "crit"
            ? "var(--crit)"
            : "var(--info)";
  return (
    <div className={className}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      {showLabel ? (
        <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)] text-num">{pct.toFixed(0)}%</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Keyboard hint                                                              */
/* -------------------------------------------------------------------------- */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 font-sans text-[0.6875rem] font-medium text-[var(--ink-3)]">
      {children}
    </kbd>
  );
}

export { useEffect };
