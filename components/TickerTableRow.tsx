"use client";

import { useEffect, useRef, useState } from "react";
import { usePrice } from "@/lib/finnhub";
import { useCompanyProfile } from "@/lib/profile";
import type { Ticker } from "@/types";

type Props = {
  ticker: Ticker;
  totalValue: number;
  onRemove: () => void;
};

export function TickerTableRow({ ticker, totalValue, onRemove }: Props) {
  const price = usePrice(ticker.symbol);
  const profile = useCompanyProfile(ticker.symbol);
  const currentPrice = price?.price;
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeen = useRef<number | null>(null);

  useEffect(() => {
    if (currentPrice == null) return;
    if (lastSeen.current != null && currentPrice !== lastSeen.current) {
      const dir = currentPrice > lastSeen.current ? "up" : "down";
      setFlash(dir);
      if (flashTimer.current != null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        flashTimer.current = null;
      }, 600);
    }
    lastSeen.current = currentPrice;
  }, [currentPrice]);

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) clearTimeout(flashTimer.current);
    };
  }, []);

  const qty = ticker.quantity;
  const entry = ticker.entryPrice;
  const value = currentPrice != null && qty != null ? currentPrice * qty : null;
  const cost = entry != null && qty != null ? entry * qty : null;
  const pl = value != null && cost != null ? value - cost : null;
  const plPct = pl != null && cost != null && cost > 0 ? (pl / cost) * 100 : null;
  const portfolioPct =
    value != null && totalValue > 0 ? (value / totalValue) * 100 : null;

  const flashClass =
    flash === "up"
      ? "flash-up-row"
      : flash === "down"
        ? "flash-down-row"
        : "";

  const plPositive = pl != null && pl >= 0;
  const plColor =
    pl == null
      ? "text-slate-400 dark:text-slate-600"
      : plPositive
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <tr
      className={`group border-b border-slate-200 transition-colors hover:bg-slate-50 dark:border-slate-800/70 dark:hover:bg-slate-900/40 ${flashClass}`}
    >
      <td className="py-3 pl-4 pr-2">
        {profile.logo ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={profile.logo}
            alt=""
            className="h-8 w-8 rounded-md bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:bg-slate-100 dark:ring-slate-700"
            loading="lazy"
          />
        ) : (
          <InitialBadge label={ticker.symbol} />
        )}
      </td>
      <td className="px-2 py-3 font-mono text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        {ticker.symbol}
      </td>
      <td className="max-w-[14rem] truncate px-2 py-3 text-xs text-slate-600 dark:text-slate-400">
        {ticker.name || profile.name || "—"}
      </td>
      <td className="px-2 py-3 text-right font-mono text-sm tabular-nums text-slate-700 dark:text-slate-300">
        {qty != null ? formatQty(qty) : <Dash />}
      </td>
      <td className="px-2 py-3 text-right font-mono text-sm tabular-nums text-slate-700 dark:text-slate-300">
        {entry != null ? `$${entry.toFixed(2)}` : <Dash />}
      </td>
      <td className="px-2 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {currentPrice != null ? (
          `$${currentPrice.toFixed(2)}`
        ) : (
          <span className="text-slate-400 dark:text-slate-600">…</span>
        )}
      </td>
      <td className="px-2 py-3 text-right font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
        {value != null ? `$${formatMoney(value)}` : <Dash />}
      </td>
      <td className={`px-2 py-3 text-right font-mono text-sm tabular-nums ${plColor}`}>
        {pl != null ? (
          <>
            <div>
              {plPositive ? "+" : "−"}${formatMoney(Math.abs(pl))}
            </div>
            {plPct != null && (
              <div className="text-[11px] opacity-80">
                {plPositive ? "+" : "−"}
                {Math.abs(plPct).toFixed(2)}%
              </div>
            )}
          </>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-3 text-right font-mono text-sm tabular-nums text-slate-600 dark:text-slate-400">
        {portfolioPct != null ? `${portfolioPct.toFixed(1)}%` : <Dash />}
      </td>
      <td className="py-3 pl-2 pr-4">
        <button
          onClick={onRemove}
          className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 focus:opacity-100 dark:text-slate-600 dark:hover:text-red-400"
          aria-label={`Remove ${ticker.symbol}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M4 4l8 8M4 12l8-8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </td>
    </tr>
  );
}

function Dash() {
  return <span className="text-slate-400 dark:text-slate-600">—</span>;
}

function InitialBadge({ label }: { label: string }) {
  const text = label.slice(0, 2).toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 font-mono text-[10px] font-semibold tracking-tight text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
      {text}
    </div>
  );
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}
