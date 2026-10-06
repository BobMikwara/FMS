import { Fragment } from "react";
import type { ResolvedColumn } from "@/lib/table-columns";

/**
 * Default phone layout for a DataTable row, built from the same visible column
 * definitions as the desktop table: the first column becomes the card title,
 * the rest are labelled with their column heading, and the Actions column sits
 * in a labelled footer. Tables that need a bespoke layout pass `mobileCard`.
 */
export function ColumnCard<T>({ row, columns }: { row: T; columns: readonly ResolvedColumn<T>[] }) {
  const dataColumns = columns.filter((column) => column.kind !== "actions");
  const actionsColumn = columns.find((column) => column.kind === "actions");
  const primary = dataColumns.find((column) => column.primary) ?? dataColumns[0];
  const details = dataColumns.filter((column) => column !== primary);
  const actionNode = actionsColumn ? actionsColumn.cell(row) : null;
  const hasActions = actionNode !== null && actionNode !== undefined && actionNode !== false;

  return (
    <article className="space-y-3">
      {primary ? (
        <div className="min-w-0 text-[0.875rem] [overflow-wrap:anywhere]" data-column={primary.key}>
          {primary.cell(row)}
        </div>
      ) : null}

      {details.length > 0 ? (
        <dl className="grid grid-cols-[minmax(5.25rem,34%)_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          {details.map((column) => (
            <Fragment key={column.key}>
              <dt className="pt-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                {column.header}
              </dt>
              <dd
                className="min-w-0 text-[0.8125rem] text-[var(--ink)] [overflow-wrap:anywhere]"
                data-column={column.key}
              >
                {column.cell(row)}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}

      {actionsColumn && hasActions ? (
        <div className="flex items-center gap-3 border-t border-[var(--line)] pt-3" data-column={actionsColumn.key}>
          <span className="flex-none text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
            {actionsColumn.header}
          </span>
          <div className="min-w-0 flex-1">{actionNode}</div>
        </div>
      ) : null}
    </article>
  );
}
