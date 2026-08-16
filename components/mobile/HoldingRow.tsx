"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCompanyProfile } from "@/lib/profile";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import {
  costBasis,
  dayChange,
  dayChangePct,
  marketValue,
  quoteFor,
  unrealizedPl,
  weightPct,
  type Quotes,
} from "@/lib/holdings";
import { formatMoney, formatQty, plColor } from "@/lib/format";
import type { Ticker } from "@/types";

type Props = {
  ticker: Ticker;
  quotes: Quotes;
  totalValue: number;
  onRemove: () => void;
};

function signed(n: number, format: (v: number) => string): string {
  return `${n >= 0 ? "+" : "−"}${format(Math.abs(n))}`;
}

export function HoldingRow({ ticker, quotes, totalValue, onRemove }: Props) {
  const router = useRouter();
  const profile = useCompanyProfile(ticker.symbol);
  const [expanded, setExpanded] = useState(false);

  const { price } = quoteFor(quotes, ticker.symbol);
  const flashClass = usePriceFlash(price);

  const value = marketValue(ticker, quotes);
  const pl = unrealizedPl(ticker, quotes);
  const cost = costBasis(ticker);
  const plPct = pl != null && cost != null && cost > 0 ? (pl / cost) * 100 : null;
  const dayPct = dayChangePct(ticker, quotes);
  const dayAbs = dayChange(ticker, quotes);
  const weight = weightPct(ticker, quotes, totalValue);

  // Weight fill tinted by today's direction. If this reads as noise on a red
  // day, swap both branches for `bg-slate-500/10` — this is a deliberate open
  // question to settle in the browser during the final verification pass.
  const fillClass =
    dayPct == null
      ? "bg-slate-400/10 dark:bg-slate-500/10"
      : dayPct >= 0
        ? "bg-emerald-500/10 dark:bg-emerald-400/10"
        : "bg-red-500/10 dark:bg-red-400/10";

  return (
    <div
      className={`relative border-b border-slate-200 dark:border-slate-800/70 ${flashClass}`}
    >
      {weight != null && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 ${fillClass}`}
          style={{ width: `${Math.min(100, weight)}%` }}
        />
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="relative flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        {profile.logo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={profile.logo}
            alt=""
            className="h-7 w-7 shrink-0 rounded bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:bg-slate-100 dark:ring-slate-700"
            loading="lazy"
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-[9px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
            {ticker.symbol.slice(0, 2).toUpperCase()}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
            {ticker.symbol}
            {weight != null && (
              <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500">
                {weight.toFixed(1)}%
              </span>
            )}
          </span>
          <span className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {ticker.quantity != null ? `${formatQty(ticker.quantity)} sh · ` : ""}
            {value != null ? `$${formatMoney(value)}` : ticker.name || profile.name || "—"}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {price != null ? `$${price.toFixed(2)}` : "…"}
          </span>
          <span className="block font-mono text-[11px] tabular-nums">
            <span className={dayPct == null ? "text-slate-400" : plColor(dayPct)}>
              {dayPct != null ? `${signed(dayPct, (v) => `${v.toFixed(2)}%`)}` : "—"}
            </span>
            {pl != null && (
              <span className={`ml-1.5 ${plColor(pl)}`}>
                {signed(pl, (v) => `$${formatMoney(v)}`)}
              </span>
            )}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="relative border-t border-slate-200/70 bg-slate-50/80 px-4 py-3 dark:border-slate-800/70 dark:bg-slate-900/50">
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Detail label="Entry" value={ticker.entryPrice != null ? `$${ticker.entryPrice.toFixed(2)}` : "—"} />
            <Detail label="Qty" value={ticker.quantity != null ? formatQty(ticker.quantity) : "—"} />
            <Detail label="% port" value={weight != null ? `${weight.toFixed(1)}%` : "—"} />
            <Detail
              label="Day $"
              value={dayAbs != null ? signed(dayAbs, (v) => `$${formatMoney(v)}`) : "—"}
              tone={dayAbs != null ? plColor(dayAbs) : undefined}
            />
          </dl>
          {plPct != null && (
            <div className="mt-2 text-center font-mono text-[11px] text-slate-500 dark:text-slate-400">
              Total return {signed(plPct, (v) => `${v.toFixed(2)}%`)}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.push(`/position/${encodeURIComponent(ticker.symbol)}`)}
              className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-300"
            >
              Open position →
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium text-red-600 dark:text-red-400"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-mono text-xs font-medium tabular-nums ${tone ?? "text-slate-900 dark:text-slate-100"}`}
      >
        {value}
      </dd>
    </div>
  );
}
