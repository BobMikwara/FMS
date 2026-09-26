"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn, truncate } from "@/lib/utils";
import { hasPermission, type SessionUser } from "@/server/auth/permissions";
import { Icon } from "./icons";
import { NAV_SECTIONS, isNavItemActive } from "./nav-config";
import { CommandPalette } from "./command-palette";
import { NotificationCenter } from "./notification-center";
import { Avatar } from "@/components/ui/layout";
import { Kbd } from "@/components/ui/feedback";
import { Button, IconButton } from "@/components/ui/button";
import { useTheme } from "./theme-provider";
import { Dropdown } from "@/components/ui/overlay";
import { StatusDot } from "@/components/ui/feedback";

export interface AppShellProps {
  user: SessionUser;
  alertCount: number;
  unreadNotifications: number;
}

export function AppShell({ user, alertCount, unreadNotifications, children }: AppShellProps & { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolved, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!searchOpen || searchTerm.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`);
        const payload = await response.json();
        if (!cancelled && payload.ok) setSearchResults(payload.data);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm, searchOpen]);

  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || hasPermission(user, item.permission)),
      })).filter((section) => section.items.length > 0),
    [user],
  );

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-40 bg-[rgb(8_11_17/0.5)] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[var(--line)] bg-[var(--surface)] transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          collapsed && "lg:w-[68px]",
        )}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 flex-none items-center gap-2.5 border-b border-[var(--line)] px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--brand)] text-[var(--brand-ink)]">
              <Icon name="fuel" className="h-4 w-4" />
            </span>
            {!collapsed ? (
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] font-semibold leading-tight text-[var(--ink)]">SmartFuel</span>
                <span className="block truncate text-[0.625rem] text-[var(--ink-3)]">{user.organizationName}</span>
              </span>
            ) : null}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {visibleSections.map((section, sectionIndex) => (
            <div key={section.title ?? `section-${sectionIndex}`} className={cn(sectionIndex > 0 && "mt-5")}>
              {section.title && !collapsed ? (
                <p className="mb-1.5 px-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-3)]">
                  {section.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isNavItemActive(item.href, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-active={active}
                        className="nav-link"
                        title={collapsed ? item.label : undefined}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <Icon name={item.icon} className="h-4 w-4 flex-none" />
                        {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                        {!collapsed && item.badge === "alerts" && alertCount > 0 ? (
                          <span className="flex-none rounded-full bg-[var(--crit-soft)] px-1.5 py-0.5 text-[0.625rem] font-bold text-[var(--crit)] text-num">
                            {alertCount > 99 ? "99+" : alertCount}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex-none border-t border-[var(--line)] p-3">
          <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <Avatar name={user.name} size="sm" />
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.75rem] font-semibold text-[var(--ink)]">{user.name}</p>
                <p className="truncate text-[0.625rem] text-[var(--ink-3)]">{user.roleName}</p>
              </div>
            ) : null}
            {!collapsed ? (
              <IconButton label="Collapse navigation" size="sm" className="h-7 w-7" onClick={() => setCollapsed((v) => !v)}>
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M10 3 5 8l5 5" />
                </svg>
              </IconButton>
            ) : null}
          </div>
        </div>
      </aside>

      <div className={cn("transition-[padding] duration-300", collapsed ? "lg:pl-[68px]" : "lg:pl-[248px]")}>
        <header className="glass sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-[var(--line)] px-4 lg:px-6">
          <IconButton label="Open navigation" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </IconButton>

          {collapsed ? (
            <IconButton label="Expand navigation" className="hidden lg:inline-flex" onClick={() => setCollapsed(false)}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 3l5 5-5 5" />
              </svg>
            </IconButton>
          ) : null}

          <div className="relative max-w-md flex-1">
            <div
              className="flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 transition-colors focus-within:border-[var(--brand)]"
              onClick={() => {
                setSearchOpen(true);
                searchRef.current?.focus();
              }}
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5 flex-none text-[var(--ink-3)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input
                ref={searchRef}
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 180)}
                placeholder="Search stations, tanks, probes, vehicles, alerts…"
                aria-label="Global search"
                className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
              />
              <span className="hidden flex-none sm:block">
                <Kbd>⌘K</Kbd>
              </span>
            </div>

            {searchOpen && (searchTerm.trim().length >= 2 || searching) ? (
              <div className="anim-scale-in absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-pop)]">
                {searching ? (
                  <div className="space-y-2 p-3">
                    <div className="h-3 w-40 rounded skeleton" />
                    <div className="h-3 w-56 rounded skeleton" />
                    <div className="h-3 w-32 rounded skeleton" />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="px-3 py-5 text-center">
                    <p className="text-[0.8125rem] font-medium text-[var(--ink)]">No matches for “{truncate(searchTerm, 28)}”</p>
                    <p className="mt-1 text-xs text-[var(--ink-2)]">
                      Try a station name, tank, probe serial, vehicle plate or alert title.
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-80 overflow-y-auto p-1.5">
                    {searchResults.map((hit) => (
                      <li key={`${hit.kind}-${hit.id}`}>
                        <Link
                          href={hit.href}
                          className="flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--surface-3)]"
                          onClick={() => {
                            setSearchOpen(false);
                            setSearchTerm("");
                          }}
                        >
                          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-3)]">
                            <Icon name={kindIcon(hit.kind)} className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.8125rem] font-medium text-[var(--ink)]">{hit.title}</span>
                            <span className="block truncate text-[0.6875rem] text-[var(--ink-3)]">{hit.subtitle}</span>
                          </span>
                          <span className="flex-none text-[0.6875rem] text-[var(--ink-2)] text-num">{hit.meta}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--ink-2)] xl:inline-flex">
              <StatusDot tone="ok" pulse />
              Live monitoring
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-9 gap-1.5 px-2.5 text-[0.75rem] sm:inline-flex"
              onClick={() => setPaletteOpen(true)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 2h4M8 2v3M3 6.5h10M4.5 6.5 3 13h10l-1.5-6.5" />
              </svg>
              Quick actions
            </Button>

            <IconButton
              label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
            >
              <Icon name={resolved === "dark" ? "sun" : "moon"} className="h-4 w-4" />
            </IconButton>

            <NotificationCenter unreadCount={unreadNotifications} />

            <Dropdown
              items={[
                { label: "Your profile", href: "/profile", icon: <Icon name="user" className="h-3.5 w-3.5" /> },
                { label: "Organization settings", href: "/settings", icon: <Icon name="org" className="h-3.5 w-3.5" /> },
                { label: "Integrations", href: "/admin/integrations", icon: <Icon name="plug" className="h-3.5 w-3.5" /> },
                {
                  label: "Sign out",
                  onSelect: handleLogout,
                  danger: true,
                  separatorBefore: true,
                  icon: <Icon name="shield" className="h-3.5 w-3.5" />,
                },
              ]}
              trigger={({ toggle, open }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  aria-haspopup="menu"
                  className="flex items-center gap-2 rounded-[var(--radius-ctl)] py-1 pl-1 pr-2 transition-colors hover:bg-[var(--surface-3)]"
                >
                  <Avatar name={user.name} size="sm" />
                  <span className="hidden min-w-0 text-left sm:block">
                    <span className="block truncate text-[0.75rem] font-semibold leading-tight text-[var(--ink)]">{user.name}</span>
                    <span className="block truncate text-[0.625rem] text-[var(--ink-3)]">{user.roleName}</span>
                  </span>
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3 w-3 flex-none text-[var(--ink-3)]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </button>
              )}
            />
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1600px] px-4 py-5 lg:px-6 lg:py-6">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} user={user} />
    </div>
  );
}

function kindIcon(kind: string) {
  const map = {
    station: "station",
    tank: "tank",
    device: "device",
    vehicle: "vehicle",
    alert: "alert",
    user: "user",
    report: "report",
  } as const;
  return map[kind as keyof typeof map] ?? "dashboard";
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  subtitle: string;
  meta: string;
  href: string;
  score: number;
}
