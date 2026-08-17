"use client";

import { useId, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { usePortfolioHistory } from "@/hooks/usePortfolioHistory";
import { computeTotals, type Quotes } from "@/lib/holdings";
import { formatMoney, plColor, signed } from "@/lib/format";
import type { PortfolioHistoryRange, Ticker } from "@/types";

const RANGES: PortfolioHistoryRange[] = ["1D", "1M", "3M", "YTD", "1Y"];

type Props = {
  tickers: Ticker[];
  quotes: Quotes;
};

export function PortfolioHero({ tickers, quotes }: Props) {
  const [range, setRange] = useState<PortfolioHistoryRange>("1M");
  const history = usePortfolioHistory(tickers, range);
  const totals = useMemo(() => computeTotals(tickers, quotes), [tickers, quotes]);

  // useId() output contains colons, which can trip up `url(#...)` lookups in
  // some browsers — strip them. The prefix keeps the id legible in devtools
  // while the suffix keeps it unique per mount, so a second chart added by
  // the analytics sheet (Tasks 12-14) can never collide with this gradient.
  const gradientId = `pp-hero-fill-${useId().replace(/:/g, "")}`;

  const points = history.kind === "loaded" ? history.data.points : [];
  const rising =
    points.length > 1 && points[points.length - 1].value >= points[0].value;
  const stroke = rising ? "#10b981" : "#ef4444";

  const dayPositive = totals.dayChange != null && totals.dayChange >= 0;

  return (
    <section className="px-4 pb-3 pt-1">
      {/* No portfolio name here — the selector directly above already shows it. */}
      <div className="font-mono text-[28px] font-bold leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
        {totals.hasAnyValue ? `$${formatMoney(totals.marketValue)}` : "—"}
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        {totals.dayChange != null ? (
          <span className={plColor(totals.dayChange)}>
            {dayPositive ? "▲" : "▼"}{" "}
            {signed(totals.dayChange, (v) => `$${formatMoney(v)}`)}
            {totals.dayChangePct != null && (
              <span className="ml-1">
                {signed(totals.dayChangePct, (v) => `${v.toFixed(2)}%`)}
              </span>
            )}
            <span className="ml-1 text-slate-500">today</span>
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-600">— today</span>
        )}
        {totals.pl != null && (
          <span className={plColor(totals.pl)}>
            {signed(totals.pl, (v) => `$${formatMoney(v)}`)}
            <span className="ml-1 text-slate-500">all time</span>
          </span>
        )}
      </div>

      <div className="mt-2 h-[72px] w-full">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={1.75}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center font-mono text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-600">
            {history.kind === "loading"
              ? "Loading history…"
              : history.kind === "error"
                ? "History unavailable"
                : "Add quantities to chart this portfolio"}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`inline-flex min-h-[34px] flex-1 items-center justify-center rounded-md border font-mono text-[11px] font-medium transition-colors ${
              range === r
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {history.kind === "loaded" && history.data.missing_symbols.length > 0 && (
        <p className="mt-2 font-mono text-[10px] text-slate-500">
          No history for {history.data.missing_symbols.join(", ")} — excluded.
        </p>
      )}
      {history.kind === "loaded" && points.length > 1 && (
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-slate-400 dark:text-slate-600">
          {history.data.caveat}
        </p>
      )}
    </section>
  );
}
