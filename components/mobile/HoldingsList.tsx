"use client";

import { useEffect, useMemo, useState } from "react";
import { HoldingRow } from "./HoldingRow";
import { MOBILE_SORT_COLUMNS, SortChips } from "./SortChips";
import { ConfirmModal } from "../ConfirmModal";
import {
  computeTotals,
  sortTickers,
  type Quotes,
  type SortState,
} from "@/lib/holdings";
import { getProfileNameSync } from "@/lib/profile";
import { formatMoney, plColor } from "@/lib/format";
import type { Ticker } from "@/types";

const SORT_STORAGE_KEY = "pp:mobile-sort:v1";

function readStoredSort(): SortState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SortState;
    // A column the chips can't display would sort invisibly with no way to
    // clear it — treat anything unrecognised as no stored preference.
    if (!(MOBILE_SORT_COLUMNS as readonly string[]).includes(parsed?.column)) {
      return null;
    }
    if (parsed?.direction !== "asc" && parsed?.direction !== "desc") return null;
    return parsed;
  } catch {
    return null;
  }
}

type Props = {
  tickers: Ticker[];
  quotes: Quotes;
  onRemove: (symbol: string) => void;
};

export function HoldingsList({ tickers, quotes, onRemove }: Props) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => setSort(readStoredSort()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || sort == null) return;
    try {
      sessionStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
    } catch {
      // ignore
    }
  }, [sort]);

  const totals = useMemo(() => computeTotals(tickers, quotes), [tickers, quotes]);

  const sorted = useMemo(
    () =>
      sortTickers(tickers, sort, {
        quotes,
        totalValue: totals.marketValue,
        nameFor: getProfileNameSync,
      }),
    [tickers, sort, quotes, totals.marketValue],
  );

  const plPositive = totals.pl != null && totals.pl >= 0;
  const plPct =
    totals.pl != null && totals.costBasis > 0
      ? (totals.pl / totals.costBasis) * 100
      : null;

  return (
    <>
      <SortChips sort={sort} onChange={setSort} />

      <div className="border-t border-slate-200 dark:border-slate-800/70">
        {sorted.map((t) => (
          <HoldingRow
            key={t.symbol}
            ticker={t}
            quotes={quotes}
            totalValue={totals.marketValue}
            onRemove={() => setPendingRemoval(t.symbol)}
          />
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 border-t-2 border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/60">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">
          Total
        </span>
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {totals.hasAnyValue ? `$${formatMoney(totals.marketValue)}` : "—"}
          </span>
          {totals.pl != null && (
            <span className={`font-mono text-[11px] tabular-nums ${plColor(totals.pl)}`}>
              {plPositive ? "+" : "−"}${formatMoney(Math.abs(totals.pl))}
              {plPct != null && (
                <span className="ml-1 opacity-80">
                  {plPositive ? "+" : "−"}
                  {Math.abs(plPct).toFixed(2)}%
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      <ConfirmModal
        open={pendingRemoval != null}
        title="Remove position"
        body={
          <>
            Remove{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-900 dark:bg-slate-800 dark:text-slate-100">
              {pendingRemoval}
            </code>{" "}
            from this portfolio? You can add it back later.
          </>
        }
        confirmLabel="Remove"
        busyLabel="Removing…"
        destructive
        onConfirm={() => {
          if (pendingRemoval) onRemove(pendingRemoval);
          setPendingRemoval(null);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </>
  );
}
