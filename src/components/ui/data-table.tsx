"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { columnWidth, mobileColumnsOf, tableMinWidth, type Column } from "@/lib/table-columns";
import { Button } from "./button";
import { Checkbox } from "./form";
import { Skeleton, Kbd } from "./feedback";
import { ColumnVisibilityMenu } from "./column-visibility-menu";
import { ColumnCard } from "./data-table-mobile-card";
import { useColumnVisibility } from "./use-column-visibility";

/* -------------------------------------------------------------------------- */
/* Column definition                                                          */
/* -------------------------------------------------------------------------- */

// Columns are defined once (see `@/lib/table-columns`). The Visible columns
// menu, the headings, the cells and the mobile card are all derived from that
// single list, so they stay in sync.
export { actionsColumn } from "@/lib/table-columns";
export type { Column } from "@/lib/table-columns";

/** Width reserved for the optional row-selection checkbox column. */
const SELECT_COLUMN_WIDTH = 36;

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
  const visibility = useColumnVisibility(columns);
  const { visibleColumns } = visibility;

  useEffect(() => {
    setLocalSearch(searchValue ?? "");
  }, [searchValue]);

  const totalRows = total ?? rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const mobileColumns = useMemo(() => mobileColumnsOf(visibleColumns), [visibleColumns]);
  const minTableWidth = tableMinWidth(visibleColumns, selectable ? SELECT_COLUMN_WIDTH : 0);
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selectedIds.includes(rowKey(row)));

  const toggleSort = (column: { key: string; sortable?: boolean }) => {
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
    <div className={cn("card relative", className)}>
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
            <ColumnVisibilityMenu
              columns={visibility.columns}
              hiddenKeys={visibility.hiddenKeys}
              canToggle={visibility.canToggle}
              onToggle={visibility.toggle}
              // A bespoke mobile card is not column-driven, so the menu only applies from md up.
              className={mobileCard ? "hidden md:block" : undefined}
            />
          </div>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton
          columns={visibleColumns.length}
          labels={visibleColumns.map((column) => column.header)}
          rows={Math.min(pageSize, 8)}
          dense={dense}
        />
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
            <table className="data" style={minTableWidth ? { minWidth: minTableWidth } : undefined}>
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
                      scope="col"
                      data-column={column.key}
                      className={cn(
                        (column.numeric || column.kind === "actions") && "text-right",
                        column.kind === "actions" && "whitespace-nowrap",
                        column.sortable && "th-sort",
                      )}
                      style={{ width: columnWidth(column) }}
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
                        <td
                          key={column.key}
                          data-column={column.key}
                          className={cn(
                            column.numeric && "text-right text-num",
                            column.kind === "actions" && "whitespace-nowrap text-right",
                            dense && "py-2",
                          )}
                          onClick={column.kind === "actions" ? (event) => event.stopPropagation() : undefined}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-[var(--line)] md:hidden">
            {rows.map((row) => (
              <div key={rowKey(row)} className="p-3">
                {mobileCard ? mobileCard(row) : <ColumnCard row={row} columns={mobileColumns} />}
              </div>
            ))}
          </div>
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

export function TableSkeleton({
  columns,
  rows,
  dense,
  labels,
}: {
  columns: number;
  rows: number;
  dense?: boolean;
  /** Real headings to show while loading, so the header row never blanks out. */
  labels?: readonly string[];
}) {
  return (
    <div>
      <div className="hidden md:block">
        <table className="data">
          <thead>
            <tr>
              {Array.from({ length: columns }).map((_, index) => (
                <th key={index}>{labels?.[index] ?? <Skeleton className="h-2.5 w-16" />}</th>
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
