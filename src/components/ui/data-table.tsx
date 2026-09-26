"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "./button";
import { Checkbox } from "./form";
import { Skeleton, Kbd } from "./feedback";

/* -------------------------------------------------------------------------- */
/* Column definition                                                          */
/* -------------------------------------------------------------------------- */

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  hideOnMobile?: boolean;
  numeric?: boolean;
  width?: string;
  help?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onSortChange?: (sort: string, order: "asc" | "desc") => void;
  sort?: string;
  order?: "asc" | "desc";
  onSearch?: (term: string) => void;
  searchPlaceholder?: string;
  searchValue?: string;
  filters?: React.ReactNode;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: (ids: string[], clear: () => void) => React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  mobileCard?: (row: T) => React.ReactNode;
  className?: string;
  toolbar?: boolean;
  dense?: boolean;
  caption?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  total,
  page = 1,
  pageSize = 25,
  onPageChange,
  onSortChange,
  sort,
  order = "asc",
  onSearch,
  searchPlaceholder = "Search…",
  searchValue,
  filters,
  selectable,
  selectedIds = [],
  onSelectionChange,
  bulkActions,
  rowActions,
  emptyTitle = "Nothing to show yet",
  emptyDescription,
  emptyAction,
  mobileCard,
  className,
  toolbar = true,
  dense,
  caption,
  onRowClick,
}: DataTableProps<T>) {
  const [localSearch, setLocalSearch] = useState(searchValue ?? "");
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    setLocalSearch(searchValue ?? "");
  }, [searchValue]);

  const totalRows = total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const visibleColumns = columns.filter((column) => !hidden.includes(column.key));
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selectedIds.includes(rowKey(row)));

  const toggleSort = (column: Column<T>) => {
    if (!column.sortable || !onSortChange) return;
    const nextOrder = sort === column.key && order === "asc" ? "desc" : "asc";
    onSortChange(column.key, nextOrder);
  };

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(selectedIds.filter((id) => !rows.some((row) => rowKey(row) === id)));
    } else {
      const next = new Set(selectedIds);
      for (const row of rows) next.add(rowKey(row));
      onSelectionChange([...next]);
    }
  };

  const toggleRow = (id: string) => {
    if (!onSelectionChange) return;
    onSelectionChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  return (
    <div className={cn("card overflow-hidden", className)}>
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
          {onSearch ? (
            <div className="relative min-w-[200px] flex-1">
              <svg
                viewBox="0 0 16 16"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-3)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input
                className="input h-8 pl-8 text-[0.8125rem]"
                placeholder={searchPlaceholder}
                value={localSearch}
                onChange={(event) => {
                  setLocalSearch(event.target.value);
                  onSearch(event.target.value);
                }}
                aria-label={searchPlaceholder}
              />
              {!localSearch ? (
                <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block">
                  <Kbd>/</Kbd>
                </span>
              ) : null}
            </div>
          ) : null}
          {filters}
          <div className="ml-auto flex items-center gap-1.5">
            {selectable && selectedIds.length > 0 && bulkActions ? (
              <div className="flex items-center gap-1.5">{bulkActions(selectedIds, () => onSelectionChange?.([]))}</div>
            ) : null}
            <div className="relative">
              <IconButton
                label="Choose columns"
                size="sm"
                onClick={() => setColumnMenuOpen((value) => !value)}
                className="h-8 w-8"
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 3.5h12M4 8h8M6.5 12.5h3" />
                </svg>
              </IconButton>
              {columnMenuOpen ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setColumnMenuOpen(false)} />
                  <div className="anim-scale-in absolute right-0 z-50 mt-1 w-52 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-pop)]">
                    <p className="px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                      Visible columns
                    </p>
                    {columns.map((column) => (
                      <label
                        key={column.key}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[0.8125rem] hover:bg-[var(--surface-3)]"
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          style={{ accentColor: "var(--brand)" }}
                          checked={!hidden.includes(column.key)}
                          onChange={() =>
                            setHidden((current) =>
                              current.includes(column.key)
                                ? current.filter((key) => key !== column.key)
                                : [...current, column.key],
                            )
                          }
                        />
                        {column.header}
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton columns={visibleColumns.length} rows={Math.min(pageSize, 8)} dense={dense} />
      ) : rows.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <h3 className="text-sm font-semibold text-[var(--ink)]">{emptyTitle}</h3>
          {emptyDescription ? (
            <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              {emptyDescription}
            </p>
          ) : null}
          {emptyAction ? <div className="mt-5 flex justify-center">{emptyAction}</div> : null}
        </div>
      ) : (
        <>
          <div className="table-wrap hidden md:block">
            <table className="data">
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              <thead>
                <tr>
                  {selectable ? (
                    <th className="w-9">
                      <Checkbox checked={Boolean(allSelected)} onChange={toggleAll} aria-label="Select all rows on this page" />
                    </th>
                  ) : null}
                  {visibleColumns.map((column) => (
                    <th
                      key={column.key}
                      className={cn(column.numeric && "text-right", column.sortable && "th-sort")}
                      style={column.width ? { width: column.width } : undefined}
                      onClick={() => toggleSort(column)}
                      title={column.help}
                      aria-sort={
                        sort === column.key
                          ? order === "asc"
                            ? "ascending"
                            : "descending"
                          : column.sortable
                            ? "none"
                            : undefined
                      }
                    >
                      <span className={cn("inline-flex items-center gap-1", column.numeric && "flex-row-reverse")}>
                        {column.header}
                        {column.sortable ? <SortIcon active={sort === column.key} order={order} /> : null}
                      </span>
                    </th>
                  ))}
                  {rowActions ? <th className="w-10 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = rowKey(row);
                  const selected = selectedIds.includes(id);
                  return (
                    <tr
                      key={id}
                      data-selected={selected}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(onRowClick && "cursor-pointer")}
                    >
                      {selectable ? (
                        <td onClick={(event) => event.stopPropagation()}>
                          <Checkbox checked={selected} onChange={() => toggleRow(id)} aria-label={`Select row ${id}`} />
                        </td>
                      ) : null}
                      {visibleColumns.map((column) => (
                        <td key={column.key} className={cn(column.numeric && "text-right text-num", dense && "py-2")}>
                          {column.cell(row)}
                        </td>
                      ))}
                      {rowActions ? (
                        <td className="text-right" onClick={(event) => event.stopPropagation()}>
                          {rowActions(row)}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mobileCard ? (
            <div className="divide-y divide-[var(--line)] md:hidden">
              {rows.map((row) => (
                <div key={rowKey(row)} className="p-3">
                  {mobileCard(row)}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {onPageChange && pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-2.5">
          <p className="text-xs text-[var(--ink-2)]">
            Showing <span className="font-semibold text-[var(--ink)]">{(page - 1) * pageSize + 1}</span>–
            <span className="font-semibold text-[var(--ink)]">{Math.min(page * pageSize, totalRows)}</span> of{" "}
            <span className="font-semibold text-[var(--ink)]">{totalRows.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m10 3-5 5 5 5" />
              </svg>
              Prev
            </Button>
            <span className="px-2 text-xs text-[var(--ink-2)]">
              Page <span className="font-semibold text-[var(--ink)]">{page}</span> / {pageCount}
            </span>
            <Button size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="Next page">
              Next
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m6 3 5 5-5 5" />
              </svg>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SortIcon({ active, order }: { active: boolean; order: "asc" | "desc" }) {
  return (
    <svg
      viewBox="0 0 10 12"
      className={cn("h-2.5 w-2.5 transition-opacity", active ? "opacity-100" : "opacity-30")}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5 0 1 5h8zM5 12 1 7h8z" transform={active && order === "desc" ? "rotate(180 5 6)" : undefined} />
    </svg>
  );
}

export function TableSkeleton({ columns, rows, dense }: { columns: number; rows: number; dense?: boolean }) {
  return (
    <div>
      <div className="hidden md:block">
        <table className="data">
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, index) => (
                <th key={index}>
                  <Skeleton className="h-2.5 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <td key={colIndex} className={dense ? "py-2" : undefined}>
                    <Skeleton className={cn("h-3", colIndex === 0 ? "w-32" : "w-20")} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-3 md:hidden">
        {Array.from({ length: Math.min(rows, 5) }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export interface TabItem {
  value: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("scrollbar-none -mb-px flex gap-1 overflow-x-auto border-b border-[var(--line)]", className)}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative flex flex-none items-center gap-2 px-3 pb-2.5 pt-2 text-[0.8125rem] font-medium transition-colors",
              active ? "text-[var(--ink)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]",
            )}
          >
            {item.icon}
            {item.label}
            {item.count != null ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold",
                  active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "bg-[var(--surface-3)] text-[var(--ink-3)]",
                )}
              >
                {item.count}
              </span>
            ) : null}
            {active ? <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-[var(--brand)]" /> : null}
          </button>
        );
      })}
    </div>
  );
}
