"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A compact single-choice control for a handful of related options, such as a
 * period preset. Implemented as a radio group, so it is one tab stop and the
 * arrow keys move the selection.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    const next = (index + options.length) % options.length;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "grid grid-cols-2 gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-0.5 sm:inline-flex sm:flex-wrap",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                select(index + 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                select(index - 1);
              }
            }}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-center text-[0.8125rem] font-medium transition-colors",
              active ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-2)] hover:text-[var(--ink)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
