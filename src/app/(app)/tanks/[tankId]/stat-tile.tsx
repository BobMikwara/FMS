/** A labelled figure on a tank page, such as "Refills (today)" or "Total consumed". */
export function StatTile({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
  hint?: string;
}) {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : "var(--ink)";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{label}</p>
      <p className="text-num mt-1.5 text-[1.125rem] font-semibold" style={{ color }}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[0.6875rem] text-[var(--ink-3)]">{hint}</p> : null}
    </div>
  );
}
