"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrice } from "@/lib/finnhub";
import { useCompanyProfile } from "@/lib/profile";
import type { Ticker } from "@/types";

type Props = {
  ticker: Ticker;
  totalValue: number;
  onRemove: () => void;
};

export function TickerCard({ ticker, totalValue, onRemove }: Props) {
  const router = useRouter();
  const price = usePrice(ticker.symbol);
  const profile = useCompanyProfile(ticker.symbol);
  const currentPrice = price?.price;

  const href = `/position/${encodeURIComponent(ticker.symbol)}`;
  const navigate = () => router.push(href);
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
  const plPct =
    pl != null && cost != null && cost > 0 ? (pl / cost) * 100 : null;
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
    <article
      role="link"
      tabIndex={0}
      onClick={navigate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate();
        }
      }}
      className={`group relative cursor-pointer border-b border-slate-200 px-4 py-3 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 dark:border-slate-800/70 dark:hover:bg-slate-900/40 ${flashClass}`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="absolute right-2 top-2 rounded p-1 text-slate-400 transition-colors hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400"
        aria-label={`Remove ${ticker.symbol}`}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 4l8 8M4 12l8-8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="flex items-start justify-between gap-3 pr-6">
        <div className="flex min-w-0 items-center gap-2.5">
          {profile.logo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.logo}
              alt=""
              className="h-9 w-9 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:bg-slate-100 dark:ring-slate-700"
              loading="lazy"
            />
          ) : (
            <InitialBadge label={ticker.symbol} />
          )}
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {ticker.symbol}
            </div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {ticker.name || profile.name || "—"}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {currentPrice != null ? (
              `$${currentPrice.toFixed(2)}`
            ) : (
              <span className="text-slate-400 dark:text-slate-600">…</span>
            )}
          </div>
          <div
            className={`font-mono text-[11px] tabular-nums leading-tight ${plColor}`}
          >
            {pl != null ? (
              <>
                {plPositive ? "+" : "−"}${formatMoney(Math.abs(pl))}
                {plPct != null && (
                  <span className="ml-1 opacity-80">
                    {plPositive ? "+" : "−"}
                    {Math.abs(plPct).toFixed(2)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-400 dark:text-slate-600">—</span>
            )}
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-1.5">
        <DataTile
          label="Value"
          value={value != null ? `$${formatMoney(value)}` : "—"}
          emphasis
        />
        <DataTile
          label="% of port"
          value={portfolioPct != null ? `${portfolioPct.toFixed(1)}%` : "—"}
        />
        <DataTile
          label="Qty"
          value={qty != null ? formatQty(qty) : "—"}
        />
        <DataTile
          label="Entry"
          value={entry != null ? `$${entry.toFixed(2)}` : "—"}
        />
      </dl>
    </article>
  );
}

function DataTile({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md bg-slate-100/70 px-2.5 py-1.5 dark:bg-slate-800/50">
      <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono tabular-nums ${
          emphasis
            ? "text-sm font-semibold text-slate-900 dark:text-slate-100"
            : "text-xs font-medium text-slate-800 dark:text-slate-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function InitialBadge({ label }: { label: string }) {
  const text = label.slice(0, 2).toUpperCase();
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 font-mono text-[10px] font-semibold tracking-tight text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
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
