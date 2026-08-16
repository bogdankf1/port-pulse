"use client";

import { SECTION_KEYS } from "../../insights/stream";
import { useInsights } from "../../insights/useInsights";
import { SectionCard } from "../../insights/SectionCard";
import type { Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
  portfolioName: string;
  portfolioId: string | null;
};

export function InsightsTab({ tickers, portfolioName, portfolioId }: Props) {
  const { loading, sections, activeKey, error, regenerate } = useInsights({
    open: true,
    tickers,
    portfolioName,
    portfolioId,
  });

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

      {SECTION_KEYS.map((key) => (
        <SectionCard
          key={key}
          sectionKey={key}
          body={sections[key]}
          active={loading && activeKey === key}
          loading={loading}
        />
      ))}
    </div>
  );
}
