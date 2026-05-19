"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getPortfolios,
  getPortfoliosServerSnapshot,
  subscribePortfolios,
} from "@/lib/portfolios";
import {
  getUser,
  getUserServerSnapshot,
  isAuthReady,
  subscribeUser,
} from "@/lib/auth";
import {
  BENCHMARKS,
  COMPARE_RANGES,
  COMPARE_RANGE_LABELS,
  fetchCompare,
  paletteColor,
  type CompareRange,
  type CompareResponse,
  type CompareSeries,
} from "@/lib/compare";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from "@/lib/theme";
import { CompareSelectors } from "@/components/compare/CompareSelectors";
import { CompareChart } from "@/components/compare/CompareChart";
import { CompareSummary } from "@/components/compare/CompareSummary";
import { AuthButton } from "@/components/AuthButton";

type FetchSlot = {
  key: string;
  data?: CompareResponse;
  error?: string;
};

export function CompareView() {
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
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const [authReady, setAuthReady] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isAuthReady(),
  );
  useEffect(() => {
    if (authReady) return;
    const id = window.setInterval(() => {
      if (isAuthReady()) {
        setAuthReady(true);
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [authReady]);

  const [range, setRange] = useState<CompareRange>("1Y");
  const [explicitPortfolios, setExplicitPortfolios] = useState<Set<string> | null>(
    null,
  );
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<Set<string>>(
    () => new Set(["SPY"]),
  );

  const selectedPortfolios = useMemo<Set<string>>(() => {
    const allowed = new Set(portfolios.map((p) => p.id));
    if (explicitPortfolios === null) {
      return allowed;
    }
    const next = new Set<string>();
    for (const id of explicitPortfolios) {
      if (allowed.has(id)) next.add(id);
    }
    return next;
  }, [portfolios, explicitPortfolios]);

  const portfolioIds = useMemo(
    () => Array.from(selectedPortfolios).sort(),
    [selectedPortfolios],
  );
  const benchmarkIds = useMemo(
    () => Array.from(selectedBenchmarks).sort(),
    [selectedBenchmarks],
  );

  const isLoggedIn = Boolean(user);
  const hasSelection = portfolioIds.length > 0 || benchmarkIds.length > 0;
  const requestedKey = `${range}|p:${portfolioIds.join(",")}|b:${benchmarkIds.join(",")}`;
  const fetchKey =
    authReady && isLoggedIn && hasSelection ? requestedKey : "";

  const [slot, setSlot] = useState<FetchSlot | null>(null);

  useEffect(() => {
    if (!fetchKey) return;
    const controller = new AbortController();
    fetchCompare({
      portfolioIds,
      benchmarkIds,
      range,
      signal: controller.signal,
    })
      .then((data) => setSlot({ key: fetchKey, data }))
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setSlot({
          key: fetchKey,
          error: err.message || "Failed to load comparison",
        });
      });
    return () => controller.abort();
    // portfolioIds/benchmarkIds/range are all encoded into fetchKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const matches = slot?.key === requestedKey;
  const showLoaded = isLoggedIn && hasSelection && matches;
  const data = showLoaded ? slot?.data : undefined;
  const error = showLoaded ? slot?.error : undefined;
  const loading = isLoggedIn && hasSelection && !matches;
  const series = data?.series ?? [];

  function togglePortfolio(id: string) {
    setExplicitPortfolios((prev) => {
      const base = prev ?? new Set(portfolios.map((p) => p.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBenchmark(id: string) {
    setSelectedBenchmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6">
        <h1 className="font-mono text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
          Compare
        </h1>
      </header>

      {!isLoggedIn && authReady ? (
        <SignInPrompt />
      ) : (
        <>
          <div className="mb-4">
            <CompareSelectors
              portfolios={portfolios}
              selectedPortfolios={selectedPortfolios}
              onTogglePortfolio={togglePortfolio}
              selectedBenchmarks={selectedBenchmarks}
              onToggleBenchmark={toggleBenchmark}
            />
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
            <RangeToggle range={range} onChange={setRange} />
            {portfolios.length === 0 && authReady && (
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-500">
                No portfolios yet — benchmarks only.
              </span>
            )}
          </div>

          <Legend series={series} theme={theme} />

          <div className="mt-3">
            <CompareChart series={series} loading={loading} error={error} />
          </div>

          <div className="mt-4">
            <CompareSummary series={series} />
          </div>

          {!loading && !error && series.length === 0 && hasSelection && isLoggedIn && (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-500">
              No historical data is available for the selected items in this
              range. Try a longer timeframe.
            </p>
          )}
          {!hasSelection && isLoggedIn && (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-500">
              Pick at least one portfolio or benchmark above to start
              comparing.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function RangeToggle({
  range,
  onChange,
}: {
  range: CompareRange;
  onChange: (r: CompareRange) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Comparison timeframe"
      className="inline-flex rounded-md border border-slate-200 bg-white/70 p-0.5 text-[11px] font-medium dark:border-slate-800 dark:bg-slate-900/60"
    >
      {COMPARE_RANGES.map((r) => {
        const active = r === range;
        return (
          <button
            key={r}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(r)}
            className={`rounded px-2.5 py-1 font-mono tracking-wide transition-colors ${
              active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {COMPARE_RANGE_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}

function Legend({
  series,
  theme,
}: {
  series: CompareSeries[];
  theme: "light" | "dark";
}) {
  if (series.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {series.map((s, idx) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-600 dark:text-slate-400"
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-3 rounded-sm"
            style={{ backgroundColor: paletteColor(idx, theme) }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function SignInPrompt() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 p-8 text-center dark:border-slate-800/70 dark:bg-slate-900/40">
      <h2 className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
        Sign in to compare portfolios
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
        Comparison overlays your saved portfolios against{" "}
        {BENCHMARKS.map((b) => b.id).join(", ")}.
      </p>
      <div className="mt-5 inline-flex">
        <AuthButton />
      </div>
    </div>
  );
}
