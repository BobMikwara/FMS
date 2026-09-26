import Link from "next/link";
import { Icon } from "@/components/layout/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--canvas)] px-5 text-center">
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)]">
        <Icon name="radar" className="h-5 w-5" />
      </span>
      <p className="text-num text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--ink-3)]">Error 404</p>
      <h1 className="mt-2 text-[1.5rem] font-semibold tracking-[-0.025em] text-[var(--ink)]">We couldn't find that page</h1>
      <p className="mt-2 max-w-md text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
        The station, tank or report you're looking for may have been archived, renamed, or the link may be out of date.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link href="/" className="btn btn-primary">
          Back to dashboard
        </Link>
        <Link href="/stations" className="btn btn-secondary">
          Browse stations
        </Link>
      </div>
    </div>
  );
}
