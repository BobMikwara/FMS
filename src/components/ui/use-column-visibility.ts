"use client";

import { useCallback, useMemo, useState } from "react";
import {
  canHideColumn,
  resolveColumns,
  toggleHiddenColumn,
  visibleColumnsOf,
  type Column,
  type ResolvedColumn,
} from "@/lib/table-columns";

export interface ColumnVisibility<T> {
  /** Every column, normalised (always has a heading). Feeds the Visible columns menu. */
  columns: ResolvedColumn<T>[];
  /** The columns that are switched on. Feeds the headings, the cells and the mobile card. */
  visibleColumns: ResolvedColumn<T>[];
  hiddenKeys: string[];
  isVisible: (key: string) => boolean;
  canToggle: (key: string) => boolean;
  toggle: (key: string) => void;
}

/**
 * Owns which columns are switched on. The menu, the headings and the cells all
 * read from the value returned here, so they cannot drift apart.
 *
 * Visibility is tracked by column key, so changing the definitions (for example
 * when permissions change) never leaves a stale heading or cell behind.
 */
export function useColumnVisibility<T>(definitions: readonly Column<T>[]): ColumnVisibility<T> {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const columns = useMemo(() => resolveColumns(definitions), [definitions]);
  const keys = useMemo(() => columns.map((column) => column.key), [columns]);
  const visibleColumns = useMemo(() => visibleColumnsOf(columns, hiddenKeys), [columns, hiddenKeys]);

  const isVisible = useCallback((key: string) => !hiddenKeys.includes(key), [hiddenKeys]);
  const canToggle = useCallback((key: string) => canHideColumn(hiddenKeys, key, keys), [hiddenKeys, keys]);
  const toggle = useCallback(
    (key: string) => setHiddenKeys((current) => toggleHiddenColumn(current, key, keys)),
    [keys],
  );

  return { columns, visibleColumns, hiddenKeys, isVisible, canToggle, toggle };
}
