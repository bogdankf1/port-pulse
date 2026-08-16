"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TickerTableRow } from "./TickerTableRow";
import { ConfirmModal } from "./ConfirmModal";
import { useQuotes } from "@/hooks/useQuotes";
import {
  computeTotals,
  nextSort,
  sortTickers,
  type SortColumn,
  type SortState,
} from "@/lib/holdings";
import { getProfileNameSync } from "@/lib/profile";
import { formatMoney, plColor } from "@/lib/format";
import type { Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
  onRemove: (symbol: string) => void;
};

export function PortfolioTable({ tickers, onRemove }: Props) {
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const quotes = useQuotes(symbols);
  const [sort, setSort] = useState<SortState | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const totals = useMemo(() => computeTotals(tickers, quotes), [tickers, quotes]);

  const sortedTickers = useMemo(
    () =>
      sortTickers(tickers, sort, {
        quotes,
        totalValue: totals.marketValue,
        nameFor: getProfileNameSync,
      }),
    [tickers, sort, quotes, totals.marketValue],
  );

  function toggle(col: SortColumn) {
    setSort((prev) => nextSort(prev, col));
  }

  const totalPlPositive = totals.pl != null && totals.pl >= 0;
  const totalPlPct =
    totals.pl != null && totals.costBasis > 0
      ? (totals.pl / totals.costBasis) * 100
      : null;
  const totalPlColor =
    totals.pl == null ? "text-slate-500" : plColor(totals.pl);

  return (
    <>
      {/* Desktop: table (≥ lg) */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800/70 dark:bg-slate-900/40 lg:block">
      <table className="min-w-full">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:border-slate-800/70 dark:bg-slate-900/60">
            <th className="py-2.5 pl-4 pr-2 text-left font-medium" />
            <SortHeader column="ticker" sort={sort} onClick={toggle} align="left">
              Ticker
            </SortHeader>
            <SortHeader column="name" sort={sort} onClick={toggle} align="left">
              Name
            </SortHeader>
            <SortHeader column="qty" sort={sort} onClick={toggle} align="right">
              Qty
            </SortHeader>
            <SortHeader column="entry" sort={sort} onClick={toggle} align="right">
              Entry
            </SortHeader>
            <SortHeader column="current" sort={sort} onClick={toggle} align="right">
              Current
            </SortHeader>
            <SortHeader column="value" sort={sort} onClick={toggle} align="right">
              Value
            </SortHeader>
            <SortHeader column="pl" sort={sort} onClick={toggle} align="right">
              P&amp;L
            </SortHeader>
            <SortHeader column="percent" sort={sort} onClick={toggle} align="right">
              % of port
            </SortHeader>
            <th className="py-2.5 pl-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {sortedTickers.map((t) => (
            <TickerTableRow
              key={t.symbol}
              ticker={t}
              totalValue={totals.marketValue}
              onRemove={() => setPendingRemoval(t.symbol)}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
            <td className="py-3 pl-4 pr-2" />
            <td
              className="px-2 py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300"
              colSpan={5}
            >
              Total
            </td>
            <td className="px-2 py-3 text-right font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {totals.hasAnyValue ? (
                `$${formatMoney(totals.marketValue)}`
              ) : (
                <span className="text-slate-400 dark:text-slate-600">—</span>
              )}
            </td>
            <td
              className={`px-2 py-3 text-right font-mono text-sm font-bold tabular-nums ${totalPlColor}`}
            >
              {totals.pl != null ? (
                <>
                  <div>
                    {totalPlPositive ? "+" : "−"}$
                    {formatMoney(Math.abs(totals.pl))}
                  </div>
                  {totalPlPct != null && (
                    <div className="text-[11px] font-normal opacity-80">
                      {totalPlPositive ? "+" : "−"}
                      {Math.abs(totalPlPct).toFixed(2)}%
                    </div>
                  )}
                </>
              ) : (
                <span className="text-slate-400 dark:text-slate-600">—</span>
              )}
            </td>
            <td className="px-2 py-3 text-right font-mono text-sm tabular-nums text-slate-600 dark:text-slate-400">
              {totals.hasAnyValue ? "100%" : "—"}
            </td>
            <td className="py-3 pl-2 pr-4" />
          </tr>
        </tfoot>
      </table>
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

function SortHeader({
  column,
  sort,
  onClick,
  align,
  children,
}: {
  column: SortColumn;
  sort: SortState | null;
  onClick: (col: SortColumn) => void;
  align: "left" | "right";
  children: ReactNode;
}) {
  const active = sort?.column === column;
  const arrow = !active ? "" : sort.direction === "asc" ? "▲" : "▼";
  const justify = align === "right" ? "justify-end" : "justify-start";
  const textAlign = align === "right" ? "text-right" : "text-left";
  return (
    <th className={`px-2 py-2.5 font-medium ${textAlign}`}>
      <button
        type="button"
        onClick={() => onClick(column)}
        className={`inline-flex items-center gap-1 select-none uppercase tracking-wider transition-colors ${justify} ${
          active
            ? "text-slate-900 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        }`}
      >
        <span>{children}</span>
        <span
          aria-hidden
          className={`text-[8px] leading-none ${active ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
        >
          {arrow || "▲"}
        </span>
      </button>
    </th>
  );
}
