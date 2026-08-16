"use client";

import { useMemo } from "react";
import { getPriceSync, usePortfolioVersion } from "@/lib/finnhub";
import { getDailyCloseSync, useDailyCloseVersion } from "@/lib/dailyClose";
import type { Quote, Quotes } from "@/lib/holdings";

/**
 * Live price + previous close for each symbol, as one map.
 *
 * Subscribing here is also what makes prev close available beyond the heatmap —
 * `useDailyCloseVersion` triggers the fetch for any symbol passed in.
 */
export function useQuotes(symbols: string[]): Quotes {
  const priceVersion = usePortfolioVersion(symbols);
  const closeVersion = useDailyCloseVersion(symbols);
  const key = symbols.slice().sort().join("|");

  return useMemo(() => {
    const map = new Map<string, Quote>();
    for (const symbol of symbols) {
      map.set(symbol, {
        price: getPriceSync(symbol) ?? null,
        prevClose: getDailyCloseSync(symbol) ?? null,
      });
    }
    return map;
    // `key` stands in for `symbols`; the version counters force a rebuild on tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, priceVersion, closeVersion]);
}
