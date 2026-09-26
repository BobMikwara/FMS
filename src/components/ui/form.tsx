"use client";

import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Field wrapper                                                              */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="ml-1 text-[var(--crit)]" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="field-error" role="alert">
          <svg viewBox="0 0 16 16" className="h-3 w-3 flex-none" fill="currentColor" aria-hidden="true">
            <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7.25 4.5h1.5v5h-1.5v-5zm0 6h1.5v1.5h-1.5V10.5z" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Text input                                                                 */
/* -------------------------------------------------------------------------- */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  prefix?: string;
  suffix?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, prefix, suffix, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn("input", prefix && "rounded-l-none", suffix && "rounded-r-none", className)}
      {...props}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className="flex">
      {prefix ? (
        <span className="inline-flex items-center rounded-l-[var(--radius-ctl)] border border-r-0 border-[var(--line)] bg-[var(--surface-3)] px-2.5 text-xs text-[var(--ink-2)]">
          {prefix}
        </span>
      ) : null}
      {input}
      {suffix ? (
        <span className="inline-flex items-center rounded-r-[var(--radius-ctl)] border border-l-0 border-[var(--line)] bg-[var(--surface-3)] px-2.5 text-xs text-[var(--ink-2)]">
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Textarea                                                                   */
/* -------------------------------------------------------------------------- */

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn("textarea", className)} {...props} />;
});

/* -------------------------------------------------------------------------- */
/* Select                                                                     */
/* -------------------------------------------------------------------------- */

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, options, placeholder, ...props },
  ref,
) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn("select", className)} {...props}>
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
});

/* -------------------------------------------------------------------------- */
/* Checkbox + switch                                                          */
/* -------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  description?: string;
}

export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 flex-none rounded border-[var(--line-strong)] bg-[var(--surface)]"
        style={{ accentColor: "var(--brand)" }}
        {...props}
      />
      {label || description ? (
        <div className="min-w-0">
          <label htmlFor={inputId} className="block text-sm font-medium text-[var(--ink)] cursor-pointer">
            {label}
          </label>
          {description ? <p className="hint">{description}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  size?: "sm" | "md";
}

export function Switch({ checked, onChange, label, description, disabled, id, size = "md" }: SwitchProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const w = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const translate = size === "sm" ? "translate-x-3.5" : "translate-x-4";
  return (
    <div className="flex items-center justify-between gap-4">
      {label || description ? (
        <div className="min-w-0">
          <label htmlFor={inputId} className="block text-sm font-medium text-[var(--ink)] cursor-pointer">
            {label}
          </label>
          {description ? <p className="hint">{description}</p> : null}
        </div>
      ) : null}
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex flex-none items-center rounded-full border transition-colors duration-200",
          w,
          checked ? "border-[var(--brand)] bg-[var(--brand)]" : "border-[var(--line-strong)] bg-[var(--surface-3)]",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "ml-0.5 inline-block rounded-full bg-white shadow-sm transition-transform duration-200",
            knob,
            checked ? translate : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors duration-150",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[0.8125rem]",
              active
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm border border-[var(--line)]"
                : "text-[var(--ink-2)] hover:text-[var(--ink)]",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
