"use client";

import { useEffect } from "react";
import { SECTION_KEYS } from "../../insights/stream";
import { useInsights } from "../../insights/useInsights";
import { SectionCard } from "../../insights/SectionCard";
import type { InsightsSectionKey, Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
  portfolioName: string;
  portfolioId: string | null;
};

type Sections = Record<InsightsSectionKey, string>;

/**
 * Last completed insights per portfolio, for the life of the page.
 *
 * AnalyticsSheet renders only the active tab, so this component unmounts and
 * remounts on every tab switch — and `useInsights` caches against a hash that
 * includes the live price, which misses on every tick. Without this, each visit
 * to the AI tab during market hours would be a fresh Claude call. Auto-generate
 * once per portfolio, replay the stored result afterwards, and leave Regenerate
 * as the explicit way to re-run.
 */
const lastRun = new Map<string, Sections>();

/**
 * Keys whose auto-run has already been started this page load.
 *
 * Latching at start rather than at completion is deliberate. `useInsights`
 * rebuilds `fetchInsights` whenever its cache key changes, and that key hashes
 * the live price — so an `open: true` auto-fetch re-fires on every tick, not
 * just once. This also absorbs StrictMode's double mount.
 */
const started = new Set<string>();

/** Deliberately price-free, unlike `hashHoldings` — this must survive ticks. */
function holdingsKey(portfolioId: string | null, tickers: Ticker[]): string {
  const parts = tickers
    .map((t) => `${t.symbol}:${t.quantity ?? "_"}:${t.entryPrice ?? "_"}`)
    .sort();
  return `${portfolioId ?? "anon"}|${parts.join(",")}`;
}

export function InsightsTab({ tickers, portfolioName, portfolioId }: Props) {
  const runKey = holdingsKey(portfolioId, tickers);
  const stored = lastRun.get(runKey);

  // Always false — the auto-run is driven below so it can be latched. `open`
  // would re-fire on every price tick, since it is paired with a callback whose
  // identity tracks the live price.
  const { loading, sections, activeKey, generatedAt, error, regenerate } =
    useInsights({
      open: false,
      tickers,
      portfolioName,
      portfolioId,
    });

  useEffect(() => {
    if (lastRun.has(runKey) || started.has(runKey)) return;
    started.add(runKey);
    void regenerate(false);
    // Release the latch if this run never completed — useInsights aborts the
    // request when we unmount, which happens on every tab switch and once more
    // under StrictMode. Without this a cut-short first visit would latch the
    // tab permanently empty.
    return () => {
      if (!lastRun.has(runKey)) started.delete(runKey);
    };
  }, [runKey, regenerate]);

  const hasLive = SECTION_KEYS.some((k) => sections[k].trim().length > 0);

  // `generatedAt` is set only after the stream parses cleanly, and cleared at
  // the start of every run — so it is the one signal that means "complete".
  // `loading` is not: useInsights drops it in a `finally` that also runs for a
  // superseded request, which would store a half-streamed result.
  useEffect(() => {
    if (generatedAt == null) return;
    lastRun.set(runKey, sections);
  }, [runKey, generatedAt, sections]);

  // While loading, always show the hook so a regenerate streams into empty
  // cards rather than flashing the previous run's text.
  const shown = loading || hasLive ? sections : (stored ?? sections);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          AI insights
        </h3>
        <button
          type="button"
          onClick={() => void regenerate(true)}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center font-mono text-[11px] font-medium text-slate-600 disabled:opacity-50 dark:text-slate-400"
        >
          {loading ? "Thinking…" : "Regenerate"}
        </button>
      </div>

      {error && (
        <p className="mb-3 font-mono text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {SECTION_KEYS.map((key) => (
          <SectionCard
            key={key}
            sectionKey={key}
            body={shown[key]}
            active={loading && activeKey === key}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}
