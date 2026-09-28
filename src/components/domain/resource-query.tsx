"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadCsv, downloadExcel, exportFilename } from "@/lib/export";

/**
 * Client-side data fetching for list screens.
 *
 * Pages are server-rendered with their first page of data (so there is never a
 * blank screen), then this hook takes over for search, filtering, sorting and
 * pagination. Errors are surfaced as a retry-able message - never a raw stack
 * trace (PRD §74).
 */

export interface QueryState {
  search: string;
  page: number;
  pageSize: number;
  sort: string;
  order: "asc" | "desc";
  [key: string]: unknown;
}

export interface FetchResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface UseResourceQueryOptions<T> {
  endpoint: string;
  initial: FetchResult<T>;
  pageSize?: number;
  debounceMs?: number;
}

/** Query-string keys that belong to the query state rather than to filters. */
const RESERVED_KEYS = new Set(["search", "q", "sort", "order", "page", "pageSize"]);

/**
 * Deep links such as `/tanks?low=true` or `/devices?status=offline` are honoured
 * on the first client render, so a KPI card that promises a filtered view
 * actually shows one. Read from `window.location` rather than `useSearchParams`
 * to keep these list screens out of a Suspense boundary.
 */
function readUrlState(pageSize: number): { state: QueryState; filters: Record<string, string> } {
  const fallback: { state: QueryState; filters: Record<string, string> } = {
    state: { search: "", page: 1, pageSize, sort: "", order: "asc" },
    filters: {},
  };
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  const filters: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (RESERVED_KEYS.has(key) || !value) continue;
    filters[key] = value;
  }
  const page = Number(params.get("page"));
  return {
    state: {
      search: params.get("search") ?? params.get("q") ?? "",
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize,
      sort: params.get("sort") ?? "",
      order: params.get("order") === "desc" ? "desc" : "asc",
    },
    filters,
  };
}

export function useResourceQuery<T>({ endpoint, initial, pageSize = 25, debounceMs = 300 }: UseResourceQueryOptions<T>) {
  const [seed] = useState(() => readUrlState(pageSize));
  const [state, setState] = useState<QueryState>(seed.state);
  const [filters, setFilters] = useState<Record<string, string>>(seed.filters);
  // A deep link means the server-rendered first page is not what the URL asked
  // for, so the table shows skeletons instead of briefly wrong rows.
  const [loading, setLoading] = useState(() => Object.keys(seed.filters).length > 0 || Boolean(seed.state.search || seed.state.sort));
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const [data, setData] = useState<FetchResult<T>>(initial);

  const buildUrl = useCallback(
    (query: QueryState, activeFilters: Record<string, string>) => {
      const params = new URLSearchParams();
      if (query.search) params.set("search", query.search);
      if (query.sort) {
        params.set("sort", query.sort);
        params.set("order", query.order);
      }
      for (const [key, value] of Object.entries(activeFilters)) {
        if (value) params.set(key, value);
      }
      params.set("page", String(query.page));
      params.set("pageSize", String(query.pageSize));
      const qs = params.toString();
      return qs ? `${endpoint}?${qs}` : endpoint;
    },
    [endpoint],
  );

  useEffect(() => {
    const isInitial =
      state.page === 1 &&
      !state.search &&
      !state.sort &&
      Object.keys(filters).every((key) => !filters[key]);
    if (isInitial) {
      setData(initial);
      setError(null);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(buildUrl(state, filters));
        const payload = await response.json();
        if (id !== requestId.current) return;
        if (!payload.ok) {
          setError(payload.error?.message ?? "Could not load the data.");
          return;
        }
        setData({ rows: payload.data.rows, total: payload.data.total, page: payload.data.page, pageSize: payload.data.pageSize });
        setError(null);
      } catch {
        if (id !== requestId.current) return;
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
    // `initial` is intentionally excluded: it is only the first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, filters, buildUrl, debounceMs]);

  const setSearch = useCallback((search: string) => {
    setState((current) => ({ ...current, search, page: 1 }));
  }, []);

  const setPage = useCallback((page: number) => {
    setState((current) => ({ ...current, page }));
  }, []);

  const setSort = useCallback((sort: string, order: "asc" | "desc") => {
    setState((current) => ({ ...current, sort, order, page: 1 }));
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setState((current) => ({ ...current, page: 1 }));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(buildUrl(state, filters));
      const payload = await response.json();
      if (payload.ok) {
        setData({ rows: payload.data.rows, total: payload.data.total, page: payload.data.page, pageSize: payload.data.pageSize });
        setError(null);
      } else {
        setError(payload.error?.message ?? "Could not load the data.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [buildUrl, state, filters]);

  return {
    rows: data.rows,
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
    loading,
    error,
    search: state.search,
    sort: state.sort,
    order: state.order,
    filters,
    setSearch,
    setPage,
    setSort,
    setFilter,
    refresh,
  };
}

/* -------------------------------------------------------------------------- */
/* Export button                                                              */
/* -------------------------------------------------------------------------- */

export function ExportButton<T>({
  rows,
  filename,
  columns,
  disabled,
}: {
  rows: T[];
  filename: string;
  columns: { header: string; value: (row: T) => string | number }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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

  const exportRows = () => rows.map((row) => columns.map((column) => column.value(row)));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || rows.length === 0}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Export
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] py-1 shadow-[var(--shadow-pop)]"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3.5 py-2 text-left text-[0.8125rem] text-[var(--ink)] hover:bg-[var(--surface-2)]"
            onClick={() => {
              downloadCsv(exportFilename(filename, "csv"), columns.map((column) => column.header), exportRows());
              setOpen(false);
            }}
          >
            Download CSV
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3.5 py-2 text-left text-[0.8125rem] text-[var(--ink)] hover:bg-[var(--surface-2)]"
            onClick={() => {
              downloadExcel(exportFilename(filename, "xls"), filename, columns.map((column) => column.header), exportRows());
              setOpen(false);
            }}
          >
            Download Excel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Retry-able error banner                                                    */
/* -------------------------------------------------------------------------- */

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card border-[var(--crit)] bg-[var(--crit-soft)] p-5" role="alert">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[0.8125rem] font-semibold text-[var(--ink)]">Could not load this data</h3>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--ink-2)]">{message}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
