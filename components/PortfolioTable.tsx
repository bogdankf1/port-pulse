"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TickerTableRow } from "./TickerTableRow";
import { getPriceSync, usePortfolioVersion } from "@/lib/finnhub";
import { getProfileNameSync } from "@/lib/profile";
import type { Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
  onRemove: (symbol: string) => void;
};

type SortColumn =
  | "ticker"
  | "name"
  | "qty"
  | "entry"
  | "current"
  | "value"
  | "pl"
  | "percent";
type SortDir = "asc" | "desc";
type SortState = { column: SortColumn; direction: SortDir };

const NUMERIC: ReadonlySet<SortColumn> = new Set([
  "qty",
  "entry",
  "current",
  "value",
  "pl",
  "percent",
]);

function defaultDir(col: SortColumn): SortDir {
  return NUMERIC.has(col) ? "desc" : "asc";
}

function sortValue(
  t: Ticker,
  col: SortColumn,
  totalValue: number,
): string | number | null {
  switch (col) {
    case "ticker":
      return t.symbol;
    case "name": {
      const n = t.name || getProfileNameSync(t.symbol) || "";
      return n || null;
    }
    case "qty":
      return t.quantity ?? null;
    case "entry":
      return t.entryPrice ?? null;
    case "current":
      return getPriceSync(t.symbol) ?? null;
    case "value": {
      const p = getPriceSync(t.symbol);
      return p != null && t.quantity != null ? p * t.quantity : null;
    }
    case "pl": {
      const p = getPriceSync(t.symbol);
      if (p == null || t.quantity == null || t.entryPrice == null) return null;
      return (p - t.entryPrice) * t.quantity;
    }
    case "percent": {
      const p = getPriceSync(t.symbol);
      if (p == null || t.quantity == null || totalValue <= 0) return null;
      return (p * t.quantity) / totalValue;
    }
  }
}

function sortTickers(
  tickers: Ticker[],
  sort: SortState | null,
  totalValue: number,
): Ticker[] {
  if (!sort) return tickers;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...tickers].sort((a, b) => {
    const va = sortValue(a, sort.column, totalValue);
    const vb = sortValue(b, sort.column, totalValue);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return va.localeCompare(vb) * dir;
    }
    return ((va as number) - (vb as number)) * dir;
  });
}

type Totals = {
  marketValue: number;
  costBasis: number;
  pl: number | null;
  hasAnyValue: boolean;
};

function computeTotals(tickers: Ticker[]): Totals {
  let marketValue = 0;
  let costBasis = 0;
  let hasAnyPL = false;
  let hasAnyValue = false;
  for (const t of tickers) {
    const price = getPriceSync(t.symbol);
    if (price != null && t.quantity != null) {
      marketValue += price * t.quantity;
      hasAnyValue = true;
    }
    if (t.entryPrice != null && t.quantity != null && price != null) {
      costBasis += t.entryPrice * t.quantity;
      hasAnyPL = true;
    }
  }
  return {
    marketValue,
    costBasis,
    pl: hasAnyPL ? marketValue - costBasis : null,
    hasAnyValue,
  };
}

export function PortfolioTable({ tickers, onRemove }: Props) {
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const version = usePortfolioVersion(symbols);
  const [sort, setSort] = useState<SortState | null>(null);

  const totals = useMemo(
    () => computeTotals(tickers),
    // version forces recompute on any price tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, version],
  );

  const sortedTickers = useMemo(
    () => sortTickers(tickers, sort, totals.marketValue),
    // version keeps price-based sorts in sync with live ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, sort, version, totals.marketValue],
  );

  function toggle(col: SortColumn) {
    setSort((prev) => {
      if (prev?.column === col) {
        return { column: col, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column: col, direction: defaultDir(col) };
    });
  }

  const totalPlPositive = totals.pl != null && totals.pl >= 0;
  const totalPlPct =
    totals.pl != null && totals.costBasis > 0
      ? (totals.pl / totals.costBasis) * 100
      : null;
  const totalPlColor =
    totals.pl == null
      ? "text-slate-500"
      : totalPlPositive
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800/70 dark:bg-slate-900/40">
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
              onRemove={() => onRemove(t.symbol)}
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
  );
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
