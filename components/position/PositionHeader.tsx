"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFinnhubPrices, usePrice } from "@/lib/finnhub";
import { useCompanyProfile } from "@/lib/profile";
import { PositionLinks } from "./PositionLinks";

type Props = {
  symbol: string;
  fallbackName?: string;
};

export function PositionHeader({ symbol, fallbackName }: Props) {
  useFinnhubPrices([symbol]);
  const price = usePrice(symbol);
  const profile = useCompanyProfile(symbol);

  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeen = useRef<number | null>(null);

  useEffect(() => {
    const p = price?.price;
    if (p == null) return;
    if (lastSeen.current != null && p !== lastSeen.current) {
      const dir = p > lastSeen.current ? "up" : "down";
      setFlash(dir);
      if (flashTimer.current != null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        flashTimer.current = null;
      }, 600);
    }
    lastSeen.current = p;
  }, [price?.price]);

  useEffect(() => {
    return () => {
      if (flashTimer.current != null) clearTimeout(flashTimer.current);
    };
  }, []);

  const current = price?.price;
  const prev = price?.prevPrice;
  const change = current != null && prev != null ? current - prev : null;
  const changePct =
    change != null && prev != null && prev !== 0 ? (change / prev) * 100 : null;
  const changePositive = change != null && change >= 0;
  const changeColor =
    change == null
      ? "text-slate-500"
      : changePositive
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  const flashClass =
    flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : "";

  const displayName = profile.name || fallbackName || "";

  return (
    <header className="space-y-4 px-4 sm:px-0">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-slate-100"
      >
        <span aria-hidden>←</span>
        <span>Back</span>
      </Link>

      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {profile.logo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={profile.logo}
              alt=""
              className="h-11 w-11 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-slate-200 dark:bg-slate-100 dark:ring-slate-700"
              loading="lazy"
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-100 font-mono text-xs font-semibold tracking-tight text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
              {symbol.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-mono text-2xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
              {symbol}
            </div>
            {displayName && (
              <div className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">
                {displayName}
              </div>
            )}
            <div className="mt-2">
              <PositionLinks symbol={symbol} />
            </div>
          </div>
        </div>

        <div
          className={`shrink-0 rounded-md px-1 text-right ${flashClass}`}
        >
          <div className="font-mono text-2xl font-bold leading-tight tabular-nums text-slate-900 dark:text-slate-100">
            {current != null ? (
              `$${current.toFixed(2)}`
            ) : (
              <span className="text-slate-400 dark:text-slate-600">…</span>
            )}
          </div>
          <div
            className={`font-mono text-xs tabular-nums ${changeColor}`}
          >
            {change != null && changePct != null
              ? `${changePositive ? "+" : "−"}$${Math.abs(change).toFixed(2)} (${changePositive ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%)`
              : "—"}
          </div>
        </div>
      </div>
    </header>
  );
}
