import type { ReactNode } from "react";

/**
 * Single source of truth for data-table columns.
 *
 * A table is described once, as a list of `Column` definitions. Everything the
 * user sees is derived from that list and nothing else:
 *
 *   column definitions -> visibility state -> Visible columns menu
 *                                          -> <th> headings
 *                                          -> <td> cells
 *                                          -> mobile card fields
 *
 * Because the menu label, the heading and the cell all read the same
 * definition, a heading can never be blank, can never disagree with the menu,
 * and can never stay behind when its column is switched off.
 */

export const ACTIONS_COLUMN_KEY = "actions";
export const ACTIONS_COLUMN_LABEL = "Actions";

/** Used for the table minimum width when only some columns declare one. */
export const DEFAULT_COLUMN_MIN_WIDTH = 96;

export type ColumnKind = "data" | "actions";

export interface Column<T> {
  /** Stable identifier. Visibility is tracked by key. */
  key: string;
  /**
   * The visible label. It is used by the table heading, the Visible columns
   * menu and the mobile card. A blank value is replaced by a sensible label
   * (see `resolveColumnLabel`), so a column can never render without a heading.
   */
  header: string;
  cell: (row: T) => ReactNode;
  /** `actions` columns are always labelled, right-aligned and never sortable. */
  kind?: ColumnKind;
  sortable?: boolean;
  /** Secondary columns are left out of the compact mobile card. */
  hideOnMobile?: boolean;
  /** Use this column as the title of the mobile card. Defaults to the first visible data column. */
  primary?: boolean;
  numeric?: boolean;
  /** CSS width hint for the heading cell (any unit). */
  width?: string;
  /**
   * Narrowest comfortable width in pixels. When any visible column declares
   * one, the table keeps at least the sum of them and scrolls horizontally
   * below that, instead of crushing its content.
   */
  minWidth?: number;
  help?: string;
}

export type ResolvedColumn<T> = Column<T> & { kind: ColumnKind };

export interface ActionsColumnOptions {
  key?: string;
  header?: string;
  width?: string;
  minWidth?: number;
}

/** "lastReading" / "last_reading" -> "Last reading". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  if (!spaced) return "Column";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The one label shown for a column everywhere. Never empty. */
export function resolveColumnLabel(column: { key: string; header?: string | null; kind?: ColumnKind }): string {
  const explicit = column.header?.trim();
  if (explicit) return explicit;
  if (column.kind === "actions" || column.key === ACTIONS_COLUMN_KEY) return ACTIONS_COLUMN_LABEL;
  return humanizeKey(column.key);
}

/**
 * Standard row-actions column. Use this instead of an unlabeled
 * `{ key: "actions", header: "" }` so the column has a heading, appears in the
 * Visible columns menu and can be switched off like any other column.
 */
export function actionsColumn<T>(cell: (row: T) => ReactNode, options: ActionsColumnOptions = {}): Column<T> {
  return {
    key: options.key ?? ACTIONS_COLUMN_KEY,
    header: options.header ?? ACTIONS_COLUMN_LABEL,
    kind: "actions",
    width: options.width,
    minWidth: options.minWidth,
    cell,
  };
}

/** Normalises definitions: every column gets a kind and a non-empty label. */
export function resolveColumns<T>(columns: readonly Column<T>[]): ResolvedColumn<T>[] {
  return columns.map((column) => {
    const kind: ColumnKind = column.kind ?? (column.key === ACTIONS_COLUMN_KEY ? "actions" : "data");
    return {
      ...column,
      kind,
      header: resolveColumnLabel({ key: column.key, header: column.header, kind }),
      sortable: kind === "actions" ? false : column.sortable,
    };
  });
}

/** The columns that are currently switched on, in definition order. */
export function visibleColumnsOf<T>(columns: readonly ResolvedColumn<T>[], hidden: readonly string[]): ResolvedColumn<T>[] {
  return columns.filter((column) => !hidden.includes(column.key));
}

/** A table must always keep at least one column on. */
export function canHideColumn(hidden: readonly string[], key: string, allKeys: readonly string[]): boolean {
  if (hidden.includes(key)) return true;
  const stillVisible = allKeys.filter((candidate) => candidate !== key && !hidden.includes(candidate));
  return stillVisible.length > 0;
}

/** Returns the next hidden-key list after toggling `key`. */
export function toggleHiddenColumn(hidden: readonly string[], key: string, allKeys: readonly string[]): string[] {
  if (hidden.includes(key)) return hidden.filter((candidate) => candidate !== key);
  if (!canHideColumn(hidden, key, allKeys)) return [...hidden];
  return [...hidden, key];
}

/** CSS width for a column's heading cell: an explicit width wins, else its minimum. */
export function columnWidth<T>(column: Pick<Column<T>, "width" | "minWidth">): string | undefined {
  if (column.width) return column.width;
  return typeof column.minWidth === "number" ? `${column.minWidth}px` : undefined;
}

/** Minimum table width in px, or `undefined` when no column opted in. */
export function tableMinWidth<T>(columns: readonly Column<T>[], reserved = 0): number | undefined {
  if (!columns.some((column) => typeof column.minWidth === "number")) return undefined;
  return columns.reduce((sum, column) => sum + (column.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH), reserved);
}

/**
 * Columns shown in the compact mobile card. Secondary (`hideOnMobile`) columns
 * are left out, but the card never ends up empty.
 */
export function mobileColumnsOf<T>(columns: readonly ResolvedColumn<T>[]): ResolvedColumn<T>[] {
  const compact = columns.filter((column) => !column.hideOnMobile || column.kind === "actions");
  return compact.some((column) => column.kind !== "actions") ? compact : [...columns];
}
