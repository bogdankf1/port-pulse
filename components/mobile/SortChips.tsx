"use client";

import { defaultDir, type SortColumn, type SortState } from "@/lib/holdings";

const MOBILE_COLUMNS: { column: SortColumn; label: string }[] = [
  { column: "value", label: "Value" },
  { column: "day", label: "Day" },
  { column: "pl", label: "P&L" },
  { column: "ticker", label: "Ticker" },
];

// Derived from MOBILE_COLUMNS so the two can't drift — used by HoldingsList
// to reject a persisted sort for a column these chips don't offer.
export const MOBILE_SORT_COLUMNS: readonly SortColumn[] = MOBILE_COLUMNS.map(
  (c) => c.column,
);

type Props = {
  sort: SortState | null;
  onChange: (next: SortState) => void;
};

export function SortChips({ sort, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Sort holdings"
      className="flex items-center gap-2 overflow-x-auto px-4 py-2"
    >
      {MOBILE_COLUMNS.map(({ column, label }) => {
        const active = sort?.column === column;
        return (
          <button
            key={column}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? {
                      column,
                      direction: sort.direction === "asc" ? "desc" : "asc",
                    }
                  : { column, direction: defaultDir(column) },
              )
            }
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border px-3 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors ${
              active
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {label}
            {active && (
              <span aria-hidden className="text-[8px]">
                {sort.direction === "asc" ? "▲" : "▼"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
