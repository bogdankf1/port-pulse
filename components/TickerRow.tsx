"use client";

import { useEffect, useRef, useState } from "react";
import { usePrice } from "@/lib/finnhub";
import type { Ticker } from "@/types";

type Props = {
  ticker: Ticker;
  onRemove: () => void;
};

export function TickerRow({ ticker, onRemove }: Props) {
  const price = usePrice(ticker.symbol);
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

  const display = currentPrice?.toFixed(2);

  return (
    <div
      className={`group relative grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-lg border border-slate-800/70 bg-slate-900/40 px-4 py-3 transition-colors hover:border-slate-700 ${
        flash === "up" ? "flash-up" : ""
      } ${flash === "down" ? "flash-down" : ""}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-800/80 font-mono text-[11px] font-bold tracking-tight text-slate-200">
        {ticker.symbol.slice(0, 4)}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-sm font-semibold tracking-tight text-slate-100">
          {ticker.symbol}
        </div>
        <div className="truncate text-xs text-slate-500">
          {ticker.name || "—"}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="font-mono text-base font-semibold tabular-nums text-slate-100">
          {display ? `$${display}` : <span className="text-slate-600">…</span>}
        </div>
        <button
          onClick={onRemove}
          className="rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 focus:opacity-100"
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
      </div>
    </div>
  );
}
