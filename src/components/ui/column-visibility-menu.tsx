"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./button";

export interface ColumnMenuItem {
  key: string;
  header: string;
  hideOnMobile?: boolean;
}

/**
 * The "Visible columns" dropdown.
 *
 * It lists every column definition (including Actions) using the same resolved
 * label the table heading uses, and reports toggles back to the shared
 * visibility state. It holds no column state of its own.
 */
export function ColumnVisibilityMenu({
  columns,
  hiddenKeys,
  canToggle,
  onToggle,
  className,
}: {
  columns: readonly ColumnMenuItem[];
  hiddenKeys: readonly string[];
  canToggle: (key: string) => boolean;
  onToggle: (key: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <IconButton
        label="Choose columns"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="h-8 w-8"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 3.5h12M4 8h8M6.5 12.5h3" />
        </svg>
      </IconButton>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            id={panelId}
            role="group"
            aria-label="Visible columns"
            className="anim-scale-in absolute right-0 z-50 mt-1 max-h-[min(22rem,calc(100vh-5rem))] w-56 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-pop)]"
          >
            <p className="px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              Visible columns
            </p>
            {columns.map((column) => {
              const visible = !hiddenKeys.includes(column.key);
              const locked = visible && !canToggle(column.key);
              return (
                <label
                  key={column.key}
                  title={locked ? "At least one column must stay visible" : undefined}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-2 py-1.5 text-[0.8125rem] leading-snug text-[var(--ink)]",
                    // Secondary columns are not part of the compact mobile card, so they are not offered there.
                    column.hideOnMobile && "hidden md:flex",
                    locked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[var(--surface-3)]",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-[0.1875rem] h-3.5 w-3.5 flex-none"
                    style={{ accentColor: "var(--brand)" }}
                    checked={visible}
                    disabled={locked}
                    onChange={() => onToggle(column.key)}
                  />
                  <span className="min-w-0">{column.header}</span>
                </label>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
