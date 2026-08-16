"use client";

import { useMemo, useSyncExternalStore } from "react";
import { colorFor, computeSlices } from "../../SectorBreakdown";
import { usePortfolioVersion } from "@/lib/finnhub";
import { useSectorsVersion } from "@/lib/sectors";
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from "@/lib/theme";
import { marketValue, type Quotes } from "@/lib/holdings";
import { formatCompactMoney } from "@/lib/format";
import type { Ticker } from "@/types";

const CONCENTRATION_THRESHOLD = 60;

type Props = { tickers: Ticker[]; quotes: Quotes };

export function MixTab({ tickers, quotes }: Props) {
  const symbols = useMemo(() => tickers.map((t) => t.symbol), [tickers]);
  const priceVersion = usePortfolioVersion(symbols);
  const sectorsVersion = useSectorsVersion(symbols);
  const theme = useSyncExternalStore(
    subscribeTheme,
    getTheme,
    getThemeServerSnapshot,
  );

  const slices = useMemo(
    () => computeSlices(tickers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickers, priceVersion, sectorsVersion],
  );

  // Top-3 concentration, computed from holdings rather than sectors — it is a
  // different question from sector tilt, and the one people get wrong.
  const concentration = useMemo(() => {
    const values = tickers
      .map((t) => marketValue(t, quotes))
      .filter((v): v is number => v != null && v > 0)
      .sort((a, b) => b - a);
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0 || values.length < 3) return null;
    const top3 = values.slice(0, 3).reduce((a, b) => a + b, 0);
    return (top3 / total) * 100;
  }, [tickers, quotes]);

  if (slices.length === 0) {
    return (
      <p className="py-8 text-center font-mono text-xs text-slate-500">
        Waiting for prices and sector data…
      </p>
    );
  }

  const total = slices.reduce((acc, s) => acc + s.value, 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Sector allocation
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {formatCompactMoney(total)}
        </span>
      </div>

      <div className="flex h-3.5 overflow-hidden rounded">
        {slices.map((s) => (
          <span
            key={s.sector}
            title={s.sector}
            style={{
              width: `${s.percent * 100}%`,
              backgroundColor: colorFor(s.sector, theme),
            }}
          />
        ))}
      </div>

      <ul className="mt-3 flex flex-col">
        {slices.map((s) => (
          <li
            key={s.sector}
            className="flex items-center gap-2.5 py-1.5 font-mono text-xs"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colorFor(s.sector, theme) }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
              {s.sector}
            </span>
            <span className="shrink-0 tabular-nums text-slate-500">
              {formatCompactMoney(s.value)}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-slate-900 dark:text-slate-100">
              {(s.percent * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>

      {concentration != null && concentration >= CONCENTRATION_THRESHOLD && (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-800 dark:border-amber-500/30 dark:text-amber-200">
          Top 3 holdings are {concentration.toFixed(1)}% of the book.
        </p>
      )}
    </div>
  );
}
