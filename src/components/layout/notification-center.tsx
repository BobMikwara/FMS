"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn, timeAgo } from "@/lib/utils";
import { IconButton } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/feedback";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  severity: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationCenter({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(unreadCount);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/notifications");
      const payload = await response.json();
      if (payload.ok) {
        setItems(payload.data);
        setUnread(payload.data.filter((item: NotificationItem) => !item.isRead).length);
      }
    } catch {
      /* keep previous state */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Subscribe to the realtime stream so the badge updates without a refresh.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/stream");
    const onMessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === "notification") {
          setUnread((count) => count + 1);
          if (open) void load();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    source.addEventListener("message", onMessage);
    return () => {
      source.removeEventListener("message", onMessage);
      source.close();
    };
  }, [open]);

  const markAllRead = async () => {
    await fetch("/api/notifications", { method: "POST" });
    setUnread(0);
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
  };

  return (
    <div className="relative" ref={containerRef}>
      <IconButton label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="relative">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 6.5a4 4 0 018 0c0 3 1 4 1 4H3s1-1 1-4zM6.5 13a1.5 1.5 0 003 0" />
          </svg>
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-[var(--crit)] px-1 text-[0.5625rem] font-bold text-white text-num">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </span>
      </IconButton>

      {open ? (
        <div className="anim-scale-in absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3.5 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Notifications</h2>
            {unread > 0 ? (
              <button type="button" onClick={markAllRead} className="text-[0.6875rem] font-medium text-[var(--brand)] hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="space-y-2.5 p-3.5">
                <div className="h-3 w-40 rounded skeleton" />
                <div className="h-3 w-52 rounded skeleton" />
                <div className="h-3 w-36 rounded skeleton" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[0.8125rem] font-medium text-[var(--ink)]">You're all caught up</p>
                <p className="mt-1 text-xs text-[var(--ink-2)]">Alerts and refill events will appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href="/alerts"
                      onClick={() => setOpen(false)}
                      className={cn("flex items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-[var(--surface-3)]")}
                    >
                      <StatusDot
                        tone={item.severity === "critical" ? "crit" : item.severity === "warning" ? "warn" : "info"}
                        className="mt-1.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] font-medium text-[var(--ink)]">{item.title}</span>
                        <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-[var(--ink-2)]">{item.body}</span>
                        <span className="mt-0.5 block text-[0.625rem] text-[var(--ink-3)]">{timeAgo(item.createdAt)}</span>
                      </span>
                      {!item.isRead ? <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-[var(--brand)]" /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-[var(--line)] p-2">
            <Link
              href="/alerts"
              onClick={() => setOpen(false)}
              className="block rounded-lg py-1.5 text-center text-[0.75rem] font-medium text-[var(--brand)] transition-colors hover:bg-[var(--surface-3)]"
            >
              View all alerts
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
