"use client";

import Link from "next/link";
import { cn, formatNumber, formatPercent, initials } from "@/lib/utils";
import { Sparkline } from "@/components/charts/charts";

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className,
  padded = true,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={cn("card", padded && "card-pad", className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate text-[0.8125rem] font-semibold text-[var(--ink)]">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-2)]">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="flex flex-none items-center gap-1.5">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page header                                                                */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("mb-6", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2.5">
      <ol className="flex flex-wrap items-center gap-1 text-[0.75rem] text-[var(--ink-3)]">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1">
            {index > 0 ? (
              <svg viewBox="0 0 16 16" className="h-3 w-3 flex-none" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="m6 3 5 5-5 5" />
              </svg>
            ) : null}
            {item.href ? (
              <Link href={item.href} className="transition-colors hover:text-[var(--ink)]">
                {item.label}
              </Link>
            ) : (
              <span className="font-medium text-[var(--ink-2)]">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI card                                                                   */
/* -------------------------------------------------------------------------- */

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "crit" | "info" | "brand";
  trend?: { value: number; label?: string; positiveIsGood?: boolean };
  spark?: number[];
  sparkColor?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  footer?: React.ReactNode;
}

const toneStyles = {
  neutral: { bg: "var(--surface-2)", fg: "var(--ink-2)" },
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  crit: { bg: "var(--crit-soft)", fg: "var(--crit)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  brand: { bg: "var(--brand-soft)", fg: "var(--brand)" },
} as const;

export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = "neutral",
  trend,
  spark,
  sparkColor,
  href,
  onClick,
  className,
  footer,
}: StatCardProps) {
  const styles = toneStyles[tone];
  const interactive = Boolean(href || onClick);
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.75rem] font-medium text-[var(--ink-2)]">{label}</p>
        {icon ? (
          <span
            className="flex h-7 w-7 flex-none items-center justify-center rounded-lg"
            style={{ background: styles.bg, color: styles.fg }}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <p className="text-num text-[1.5rem] font-semibold leading-none tracking-[-0.03em] text-[var(--ink)]">
          {value}
          {unit ? <span className="ml-1 text-[0.8125rem] font-medium text-[var(--ink-3)]">{unit}</span> : null}
        </p>
        {spark && spark.length > 1 ? (
          <Sparkline values={spark} color={sparkColor ?? styles.fg} width={72} height={26} />
        ) : null}
      </div>
      {trend ? (
        <p className="mt-2 flex items-center gap-1 text-[0.75rem]">
          <span
            className="font-semibold text-num"
            style={{
              color: trend.positiveIsGood === false
                ? trend.value >= 0
                  ? "var(--crit)"
                  : "var(--ok)"
                : trend.value >= 0
                  ? "var(--ok)"
                  : "var(--crit)",
            }}
          >
            {trend.value >= 0 ? "\u2191" : "\u2193"} {formatPercent(Math.abs(trend.value), 1)}
          </span>
          {trend.label ? <span className="text-[var(--ink-3)]">{trend.label}</span> : null}
        </p>
      ) : null}
      {hint ? <p className="mt-2 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">{hint}</p> : null}
      {footer ? <div className="mt-3 border-t border-[var(--line)] pt-2.5">{footer}</div> : null}
    </>
  );

  const shellClass = cn("card card-hover kpi block w-full p-4 text-left sm:p-5", interactive && "cursor-pointer", className);

  if (href) {
    return (
      <Link href={href} className={shellClass}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shellClass}>
        {content}
      </button>
    );
  }

  return <div className={shellClass}>{content}</div>;
}

/* -------------------------------------------------------------------------- */
/* Metric row (label / value pairs)                                           */
/* -------------------------------------------------------------------------- */

export function MetricRow({
  items,
  className,
  columns = 2,
}: {
  items: { label: string; value: React.ReactNode; hint?: string; tone?: "ok" | "warn" | "crit" | "info" }[];
  className?: string;
  columns?: 2 | 3;
}) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-3.5", columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3", className)}>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="min-w-0">
          <dt className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--ink-3)]">{item.label}</dt>
          <dd
            className="mt-1 text-num text-[0.9375rem] font-semibold text-[var(--ink)]"
            style={
              item.tone === "ok"
                ? { color: "var(--ok)" }
                : item.tone === "warn"
                  ? { color: "var(--warn)" }
                  : item.tone === "crit"
                    ? { color: "var(--crit)" }
                    : item.tone === "info"
                      ? { color: "var(--info)" }
                      : undefined
            }
          >
            {item.value}
          </dd>
          {item.hint ? <p className="mt-0.5 text-[0.6875rem] text-[var(--ink-3)]">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

export function Avatar({
  name,
  size = "md",
  className,
  tone,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  tone?: string;
}) {
  const dimension = { xs: "h-6 w-6 text-[0.625rem]", sm: "h-7 w-7 text-[0.6875rem]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" }[size];
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full font-semibold",
        dimension,
        className,
      )}
      style={{ background: tone ?? "var(--brand-soft)", color: tone ? "#fff" : "var(--brand)" }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Section header                                                             */
/* -------------------------------------------------------------------------- */

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[0.9375rem] font-semibold text-[var(--ink)]">{title}</h2>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key-value list                                                             */
/* -------------------------------------------------------------------------- */

export function KeyValueList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-[var(--line)]", className)}>
      {items.map((item, index) => (
        <div key={index} className="flex items-start justify-between gap-4 py-2">
          <dt className="text-[0.75rem] text-[var(--ink-2)]">{item.label}</dt>
          <dd className="min-w-0 text-right text-[0.8125rem] font-medium text-[var(--ink)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline notice                                                              */
/* -------------------------------------------------------------------------- */

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warn" | "crit" | "ok";
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: { bg: "var(--info-soft)", fg: "var(--info)", border: "color-mix(in srgb, var(--info) 30%, transparent)" },
    warn: { bg: "var(--warn-soft)", fg: "var(--warn)", border: "color-mix(in srgb, var(--warn) 30%, transparent)" },
    crit: { bg: "var(--crit-soft)", fg: "var(--crit)", border: "color-mix(in srgb, var(--crit) 30%, transparent)" },
    ok: { bg: "var(--ok-soft)", fg: "var(--ok)", border: "color-mix(in srgb, var(--ok) 30%, transparent)" },
  }[tone];
  return (
    <div
      className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3", className)}
      style={{ background: styles.bg, borderColor: styles.border }}
      role={tone === "crit" ? "alert" : "status"}
    >
      <span className="mt-0.5 flex-none" style={{ color: styles.fg }}>
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7.25 4.5h1.5v5h-1.5v-5zm0 6h1.5v1.5h-1.5V10.5z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-[0.8125rem] font-semibold" style={{ color: styles.fg }}>{title}</p> : null}
        {children ? <div className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{children}</div> : null}
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Number with animated transition                                            */
/* -------------------------------------------------------------------------- */

export function AnimatedNumber({
  value,
  format = (v: number) => formatNumber(v),
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  return (
    <span className={cn("text-num tabular-nums transition-all duration-500", className)} key={value}>
      {format(value)}
    </span>
  );
}
