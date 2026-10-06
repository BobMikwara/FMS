"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { hasOrganizationWideStationAccess } from "@/server/auth/authorization";
import { hasPermission, type SessionUser } from "@/server/auth/permissions";
import { Icon, type IconName } from "./icons";
import { Kbd } from "@/components/ui/feedback";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  href: string;
  permission?: string;
  group: string;
}

const COMMANDS: Command[] = [
  { id: "dash", label: "Go to dashboard", icon: "dashboard", href: "/", group: "Navigate", permission: "dashboard.view" },
  { id: "stations", label: "Go to stations", icon: "station", href: "/stations", group: "Navigate", permission: "stations.view" },
  { id: "tanks", label: "Go to tanks", icon: "tank", href: "/tanks", group: "Navigate", permission: "tanks.view" },
  { id: "movements", label: "Go to fuel movement ledger", icon: "movement", href: "/movements", group: "Navigate", permission: "movements.view" },
  { id: "alerts", label: "Go to alerts", icon: "alert", href: "/alerts", group: "Navigate", permission: "alerts.view" },
  { id: "rules", label: "Go to alert rules", icon: "sliders", href: "/alerts/rules", group: "Navigate", permission: "alert_rules.view" },
  { id: "reports", label: "Go to reports", icon: "report", href: "/reports", group: "Navigate", permission: "reports.view" },
  { id: "vehicles", label: "Go to vehicles", icon: "vehicle", href: "/vehicles", group: "Navigate", permission: "vehicles.view" },
  { id: "devices", label: "Go to devices", icon: "device", href: "/devices", group: "Navigate", permission: "devices.view" },
  { id: "map", label: "Open the network map", icon: "map", href: "/map", group: "Navigate", permission: "map.view" },
  { id: "audit", label: "Open the audit log", icon: "audit", href: "/audit-logs", group: "Navigate", permission: "audit.view" },
  { id: "users", label: "Manage users", icon: "users", href: "/admin/users", group: "Navigate", permission: "users.view" },
  { id: "roles", label: "Manage roles & permissions", icon: "shield", href: "/admin/roles", group: "Navigate", permission: "roles.view" },
  { id: "integrations", label: "Manage integrations", icon: "plug", href: "/admin/integrations", group: "Navigate", permission: "integrations.view" },
  { id: "settings", label: "Open settings", icon: "settings", href: "/settings", group: "Navigate", permission: "settings.view" },
  { id: "act-station", label: "Add station", hint: "Guided setup wizard", icon: "station", href: "/stations/new", group: "Create", permission: "stations.create" },
  { id: "act-tank", label: "Add tank", icon: "tank", href: "/tanks/new", group: "Create", permission: "tanks.create" },
  { id: "act-device", label: "Register device", icon: "device", href: "/devices/new", group: "Create", permission: "devices.create" },
  { id: "act-vehicle", label: "Add vehicle", icon: "vehicle", href: "/vehicles/new", group: "Create", permission: "vehicles.create" },
  { id: "act-user", label: "Invite user", icon: "user", href: "/admin/users/new", group: "Create", permission: "users.create" },
  { id: "act-rule", label: "Create alert rule", icon: "sliders", href: "/alerts/rules/new", group: "Create", permission: "alert_rules.manage" },
  { id: "act-report", label: "Generate report", hint: "PDF, Excel or CSV", icon: "report", href: "/reports/new", group: "Create", permission: "reports.create" },
  { id: "act-scheduled", label: "Schedule a report", icon: "clock", href: "/reports/scheduled", group: "Create", permission: "reports.schedule" },
];

interface EntityHit {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  meta: string;
  href: string;
}

export function CommandPalette({ open, onClose, user }: { open: boolean; onClose: () => void; user: SessionUser }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [hits, setHits] = useState<EntityHit[]>([]);

  const commands = useMemo(
    () => COMMANDS.filter((command) =>
      (!command.permission || hasPermission(user, command.permission)) &&
      (command.id !== "act-station" || hasOrganizationWideStationAccess(user)),
    ),
    [user],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((command) => `${command.label} ${command.group}`.toLowerCase().includes(term));
  }, [commands, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const command of filtered) {
      const list = map.get(command.group) ?? [];
      list.push(command);
      map.set(command.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      setHits([]);
      return;
    }
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=6`);
        const payload = await response.json();
        if (!cancelled && payload.ok) setHits(payload.data?.hits ?? []);
      } catch {
        if (!cancelled) setHits([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    const total = Math.max(1, filtered.length + hits.length);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % total);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + total) % total);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const command = filtered[activeIndex];
        if (command) {
          router.push(command.href);
          onClose();
          return;
        }
        const hit = hits[activeIndex - filtered.length];
        if (hit) {
          router.push(hit.href);
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, hits, activeIndex, onClose, router]);

  if (!open) return null;

  let flatIndex = -1;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center p-4 pt-[12vh]">
      <div className="anim-fade-in absolute inset-0 bg-[rgb(8_11_17/0.55)] backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="anim-scale-in relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4">
          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-none text-[var(--ink-3)]" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or run a command…"
            aria-label="Search or run a command"
            className="h-12 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {hits.length > 0 ? (
            <div className="mb-2">
              <p className="px-2 py-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Results</p>
              <ul>
                {hits.map((hit) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          router.push(hit.href);
                          onClose();
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          activeIndex === index ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-3)]",
                        )}
                      >
                        <Icon name={entityIcon(hit.kind)} className="h-3.5 w-3.5 flex-none text-[var(--ink-3)]" />
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-[var(--ink)]">{hit.title}</span>
                        <span className="flex-none text-[0.6875rem] text-[var(--ink-3)]">{hit.subtitle}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {grouped.length === 0 && hits.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[0.8125rem] font-medium text-[var(--ink)]">No commands match “{query}”</p>
              <p className="mt-1 text-xs text-[var(--ink-2)]">Try “add tank”, “alerts”, “report” or a station name.</p>
            </div>
          ) : null}

          {grouped.map(([group, items]) => (
            <div key={group} className="mb-2">
              <p className="px-2 py-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--ink-3)]">{group}</p>
              <ul>
                {items.map((command) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <li key={command.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          router.push(command.href);
                          onClose();
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                          activeIndex === index ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-3)]",
                        )}
                      >
                        <Icon name={command.icon} className="h-3.5 w-3.5 flex-none text-[var(--ink-3)]" />
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-[var(--ink)]">{command.label}</span>
                        {command.hint ? <span className="flex-none text-[0.6875rem] text-[var(--ink-3)]">{command.hint}</span> : null}
                        {activeIndex === index ? <Kbd>↵</Kbd> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-2 text-[0.6875rem] text-[var(--ink-3)]">
          <span className="flex items-center gap-2">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to navigate
          </span>
          <span className="flex items-center gap-2">
            <Kbd>↵</Kbd> to select
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function entityIcon(kind: string): IconName {
  const map: Record<string, IconName> = {
    station: "station",
    tank: "tank",
    device: "device",
    vehicle: "vehicle",
    alert: "alert",
    user: "user",
    report: "report",
  };
  return map[kind] ?? "dashboard";
}
