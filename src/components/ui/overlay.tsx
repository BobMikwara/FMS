"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./button";

/* -------------------------------------------------------------------------- */
/* Modal                                                                      */
/* -------------------------------------------------------------------------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** When true, clicking the backdrop will not dismiss (use for forms). */
  persistent?: boolean;
}

const modalSize = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, description, children, footer, size = "md", persistent }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !persistent) {
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key === "Tab" && panelRef.current) {
        // Simple focus trap
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const preferred = panelRef.current?.querySelector<HTMLElement>("[data-autofocus],input:not([type='hidden']),textarea,select");
      (preferred ?? panelRef.current?.querySelector<HTMLElement>("button"))?.focus();
    }, 40);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, persistent]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="anim-fade-in fixed inset-0 bg-[rgb(8_11_17/0.55)] backdrop-blur-[2px]"
        onClick={persistent ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "anim-scale-in relative z-10 my-auto w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-pop)]",
          modalSize[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[0.9375rem] font-semibold text-[var(--ink)]">
              {title}
            </h2>
            {description ? <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{description}</p> : null}
          </div>
          <IconButton label="Close dialog" onClick={onClose} className="-mr-1 -mt-1">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Confirm dialog                                                             */
/* -------------------------------------------------------------------------- */

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Extra confirmation input, e.g. typing a station name. */
  confirmPhrase?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  confirmPhrase,
  loading,
}: ConfirmDialogProps) {
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setPhrase("");
  }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      persistent={busy || loading}
      footer={
        <>
          <Button onClick={onClose} disabled={busy || loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={handleConfirm}
            disabled={busy || loading || (confirmPhrase ? phrase.trim() !== confirmPhrase : false)}
            loading={busy || loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{message}</div>
        {confirmPhrase ? (
          <div>
            <label className="label" htmlFor="confirm-phrase">
              Type <span className="font-semibold text-[var(--ink)]">{confirmPhrase}</span> to confirm
            </label>
            <input
              id="confirm-phrase"
              className="input"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              autoComplete="off"
              data-autofocus
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                     */
/* -------------------------------------------------------------------------- */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}

export function Drawer({ open, onClose, title, description, children, footer, width = "max-w-md" }: DrawerProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div className="anim-fade-in absolute inset-0 bg-[rgb(8_11_17/0.5)]" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "anim-slide-in absolute right-0 top-0 flex h-full w-full flex-col border-l border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-pop)]",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[0.9375rem] font-semibold text-[var(--ink)]">
              {title}
            </h2>
            {description ? <p className="mt-1 text-[0.8125rem] text-[var(--ink-2)]">{description}</p> : null}
          </div>
          <IconButton label="Close panel" onClick={onClose} className="-mr-1 -mt-1">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-[var(--line)] px-5 py-3.5">{footer}</div> : null}
      </aside>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Dropdown menu                                                              */
/* -------------------------------------------------------------------------- */

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  disabled?: boolean;
}

export function Dropdown({
  trigger,
  items,
  align = "right",
  width = "w-56",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="relative" ref={containerRef}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div
          role="menu"
          className={cn(
            "anim-scale-in absolute z-50 mt-1.5 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--shadow-pop)]",
            width,
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => {
            const content = (
              <>
                {item.icon ? <span className="flex-none text-[var(--ink-3)]">{item.icon}</span> : null}
                <span className="flex-1 truncate">{item.label}</span>
              </>
            );
            const className = cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors",
              item.danger ? "text-[var(--crit)] hover:bg-[var(--crit-soft)]" : "text-[var(--ink)] hover:bg-[var(--surface-3)]",
              item.disabled && "pointer-events-none opacity-50",
            );
            return (
              <div key={`${item.label}-${index}`}>
                {item.separatorBefore ? <div className="my-1 h-px bg-[var(--line)]" /> : null}
                {item.href ? (
                  <a
                    href={item.href}
                    role="menuitem"
                    className={className}
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={className}
                    disabled={item.disabled}
                    onClick={() => {
                      close();
                      item.onSelect?.();
                    }}
                  >
                    {content}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const position = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          className={cn(
            "anim-fade-in pointer-events-none absolute z-[80] whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--ink)] shadow-[var(--shadow-pop)]",
            position,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
