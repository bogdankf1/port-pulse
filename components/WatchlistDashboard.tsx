"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  clearWatchlist,
  getWatchlist,
  getWatchlistServerSnapshot,
  removeFromWatchlist,
  subscribeWatchlist,
} from "@/lib/storage";
import { isAuthReady, subscribeUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useFinnhubPrices } from "@/lib/finnhub";
import { TickerRow } from "./TickerRow";
import type { ConnectionState } from "@/types";

const SOFT_CAP = 25;

export function WatchlistDashboard() {
  const router = useRouter();
  const tickers = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlist,
    getWatchlistServerSnapshot,
  );
  const authReady = useSyncExternalStore(
    subscribeUser,
    isAuthReady,
    () => true,
  );

  useEffect(() => {
    if (tickers.length > 0) return;
    if (isSupabaseConfigured() && !authReady) return;
    router.replace("/");
  }, [tickers.length, authReady, router]);

  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const connState = useFinnhubPrices(symbols);

  if (tickers.length === 0) return null;

  const overCap = tickers.length > SOFT_CAP;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-100">
            Port Pulse
          </h1>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <ConnectionDot state={connState} />
            <span>{labelFor(connState)}</span>
            <span className="text-slate-700">·</span>
            <span>
              {tickers.length} {tickers.length === 1 ? "ticker" : "tickers"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            + Add portfolio
          </button>
          <button
            onClick={() => {
              clearWatchlist();
              router.replace("/");
            }}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-red-400"
          >
            Clear all
          </button>
        </div>
      </header>

      {overCap && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Finnhub free tier supports about {SOFT_CAP} live symbols per
          connection. Some prices may not stream until you remove some.
        </div>
      )}

      <div className="space-y-2">
        {tickers.map((t) => (
          <TickerRow
            key={t.symbol}
            ticker={t}
            onRemove={() => removeFromWatchlist(t.symbol)}
          />
        ))}
      </div>
    </div>
  );
}

function labelFor(state: ConnectionState): string {
  switch (state) {
    case "open":
      return "Live";
    case "connecting":
      return "Connecting…";
    case "closed":
      return "Reconnecting…";
    default:
      return "Idle";
  }
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const color =
    state === "open"
      ? "bg-emerald-400"
      : state === "connecting" || state === "closed"
      ? "bg-amber-400"
      : "bg-slate-500";
  return (
    <span className="relative inline-flex h-2 w-2">
      {state === "open" && (
        <span className="absolute inset-0 inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      )}
      <span className={`relative inline-block h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}
