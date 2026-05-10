"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  clearWatchlist,
  getWatchlist,
  getWatchlistServerSnapshot,
  removeFromWatchlist,
  subscribeWatchlist,
} from "@/lib/storage";
import {
  getUser,
  getUserServerSnapshot,
  subscribeUser,
} from "@/lib/auth";
import { useFinnhubPrices } from "@/lib/finnhub";
import {
  getActiveIdServerSnapshot,
  getActivePortfolioId,
  getPortfolios,
  getPortfoliosServerSnapshot,
  subscribeActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import { PortfolioTable } from "./PortfolioTable";
import { PortfolioSelector } from "./PortfolioSelector";
import { Uploader } from "./Uploader";
import { UploaderModal } from "./UploaderModal";

const SOFT_CAP = 25;

export function WatchlistDashboard() {
  const tickers = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlist,
    getWatchlistServerSnapshot,
  );
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  const portfolios = useSyncExternalStore(
    subscribePortfolios,
    getPortfolios,
    getPortfoliosServerSnapshot,
  );
  const activeId = useSyncExternalStore(
    subscribeActivePortfolio,
    getActivePortfolioId,
    getActiveIdServerSnapshot,
  );

  const [uploaderOpen, setUploaderOpen] = useState(false);

  const isLoggedIn = Boolean(user);
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  useFinnhubPrices(symbols);

  const overCap = tickers.length > SOFT_CAP;
  const showSelector = isLoggedIn && portfolios.length > 0;
  const portfolioReady = !isLoggedIn || activeId != null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {showSelector && <PortfolioSelector />}
          <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
            {tickers.length} {tickers.length === 1 ? "ticker" : "tickers"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tickers.length > 0 && (
            <>
              <button
                onClick={() => setUploaderOpen(true)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
              >
                + Add screenshot
              </button>
              <button
                onClick={() => clearWatchlist()}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-red-500 dark:hover:text-red-400"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      </header>

      {overCap && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:text-amber-200">
          Finnhub free tier supports about {SOFT_CAP} live symbols per
          connection. Some prices may not stream until you remove some.
        </div>
      )}

      {tickers.length > 0 ? (
        <PortfolioTable
          tickers={tickers}
          onRemove={(symbol) => removeFromWatchlist(symbol)}
        />
      ) : (
        <EmptyPortfolio ready={portfolioReady} />
      )}

      <UploaderModal
        open={uploaderOpen}
        onClose={() => setUploaderOpen(false)}
      />
    </main>
  );
}

function EmptyPortfolio({ ready }: { ready: boolean }) {
  if (!ready) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white/40 px-6 py-16 text-center dark:border-slate-800/70 dark:bg-slate-900/40">
        <div className="font-mono text-xs uppercase tracking-widest text-slate-400 dark:text-slate-600">
          Loading portfolio…
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <div className="text-center">
        <div className="font-mono text-sm font-medium text-slate-700 dark:text-slate-200">
          This portfolio is empty
        </div>
        <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
          Drop a screenshot of your brokerage portfolio to populate it.
        </p>
      </div>
      <Uploader mode="first" onComplete={() => {}} />
    </div>
  );
}
