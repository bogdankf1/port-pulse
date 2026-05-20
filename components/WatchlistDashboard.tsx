"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
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
import Link from "next/link";
import { PortfolioTable } from "./PortfolioTable";
import { PortfolioSelector } from "./PortfolioSelector";
import { PortfolioGearMenu } from "./PortfolioGearMenu";
import { PortfolioHeatmap } from "./PortfolioHeatmap";
import { SectorBreakdown } from "./SectorBreakdown";
import { Uploader } from "./Uploader";
import { UploaderModal } from "./UploaderModal";
import { AddTickerModal } from "./AddTickerModal";
import { AddMenu } from "./AddMenu";
import { InsightsDrawer } from "./InsightsDrawer";

type ViewMode = "table" | "heatmap";
const VIEW_STORAGE_KEY = "pp:view:v1";

function readStoredView(): ViewMode {
  if (typeof window === "undefined") return "table";
  try {
    const v = sessionStorage.getItem(VIEW_STORAGE_KEY);
    return v === "heatmap" ? "heatmap" : "table";
  } catch {
    return "table";
  }
}

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
  const [addOpen, setAddOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("table");

  useEffect(() => {
    queueMicrotask(() => setView(readStoredView()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // ignore
    }
  }, [view]);

  const isLoggedIn = Boolean(user);
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  useFinnhubPrices(symbols);

  const overCap = tickers.length > SOFT_CAP;
  const showSelector = isLoggedIn && portfolios.length > 0;
  const portfolioReady = !isLoggedIn || activeId != null;
  const activePortfolioName = useMemo(() => {
    if (!isLoggedIn) return undefined;
    return portfolios.find((p) => p.id === activeId)?.name;
  }, [isLoggedIn, portfolios, activeId]);

  return (
    <main className="mx-auto w-full max-w-6xl py-4 sm:px-6 sm:py-10">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 sm:mb-6 sm:px-0">
        <div className="flex items-center gap-3">
          {showSelector && <PortfolioSelector />}
          <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
            {tickers.length} {tickers.length === 1 ? "ticker" : "tickers"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tickers.length > 0 && (
            <>
              <ViewToggle view={view} onChange={setView} />
              <AddMenu
                onAddTicker={() => setAddOpen(true)}
                onAddScreenshot={() => setUploaderOpen(true)}
              />
              <button
                onClick={() => setInsightsOpen(true)}
                aria-label="AI insights"
                title="AI insights"
                className="inline-flex h-[30px] items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100 sm:px-2.5"
              >
                <SparkIcon />
                <span className="hidden sm:inline">Insights</span>
              </button>
              {isLoggedIn && (
                <Link
                  href="/compare"
                  aria-label="Compare portfolios"
                  title="Compare portfolios"
                  className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-300 text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100"
                >
                  <ScaleIcon />
                </Link>
              )}
              {isLoggedIn && <PortfolioGearMenu />}
            </>
          )}
        </div>
      </header>

      {overCap && (
        <div className="mx-4 mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:text-amber-200 sm:mx-0">
          Finnhub free tier supports about {SOFT_CAP} live symbols per
          connection. Some prices may not stream until you remove some.
        </div>
      )}

      {tickers.length > 0 ? (
        <>
          <SectorBreakdown tickers={tickers} />
          {view === "table" ? (
            <PortfolioTable
              tickers={tickers}
              onRemove={(symbol) => removeFromWatchlist(symbol)}
            />
          ) : (
            <PortfolioHeatmap tickers={tickers} />
          )}
        </>
      ) : (
        <EmptyPortfolio
          ready={portfolioReady}
          onAddTicker={() => setAddOpen(true)}
        />
      )}

      <UploaderModal
        open={uploaderOpen}
        onClose={() => setUploaderOpen(false)}
      />
      <AddTickerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        activePortfolioName={activePortfolioName}
      />
      <InsightsDrawer
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        tickers={tickers}
        portfolioName={activePortfolioName ?? "Portfolio"}
        portfolioId={activeId ?? null}
      />
    </main>
  );
}

function EmptyPortfolio({
  ready,
  onAddTicker,
}: {
  ready: boolean;
  onAddTicker: () => void;
}) {
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
      <button
        type="button"
        onClick={onAddTicker}
        className="font-mono text-[11px] text-slate-500 underline-offset-4 transition-colors hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
      >
        Or add a ticker manually
      </button>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const baseClass =
    "px-2.5 py-1 text-[11px] font-medium font-mono uppercase tracking-wider transition-colors";
  const activeClass =
    "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900";
  const idleClass =
    "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200";
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "table"}
        onClick={() => onChange("table")}
        className={`${baseClass} ${view === "table" ? activeClass : idleClass}`}
      >
        Table
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "heatmap"}
        onClick={() => onChange("heatmap")}
        className={`${baseClass} border-l border-slate-300 dark:border-slate-700 ${view === "heatmap" ? activeClass : idleClass}`}
      >
        Heatmap
      </button>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.6 5.6l2.1 2.1" />
      <path d="M16.3 16.3l2.1 2.1" />
      <path d="M5.6 18.4l2.1-2.1" />
      <path d="M16.3 7.7l2.1-2.1" />
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v18" />
      <path d="M5 21h14" />
      <path d="M6 8h12" />
      <path d="M6 8l-3 7a4 4 0 0 0 6 0z" />
      <path d="M18 8l-3 7a4 4 0 0 0 6 0z" />
    </svg>
  );
}
