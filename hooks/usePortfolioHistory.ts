"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PortfolioHistoryRange,
  PortfolioHistoryResponse,
  Ticker,
} from "@/types";

export type HistoryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: PortfolioHistoryResponse }
  | { kind: "error"; message: string };

/**
 * Keyed on the holdings shape and range only. A live price tick must never
 * trigger a refetch — same approach as RiskMetricsPanel's holdingsKey.
 */
function holdingsKey(holdings: { symbol: string; quantity: number }[]): string {
  return holdings
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((h) => `${h.symbol}:${h.quantity}`)
    .join("|");
}

export function usePortfolioHistory(
  tickers: Ticker[],
  range: PortfolioHistoryRange,
): HistoryState {
  const holdings = useMemo(
    () =>
      tickers
        .filter(
          (t): t is Ticker & { quantity: number } =>
            typeof t.quantity === "number" && t.quantity > 0,
        )
        .map((t) => ({ symbol: t.symbol, quantity: t.quantity })),
    [tickers],
  );

  const key = useMemo(() => holdingsKey(holdings), [holdings]);
  const [state, setState] = useState<HistoryState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (holdings.length === 0) {
      queueMicrotask(() => setState({ kind: "idle" }));
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    queueMicrotask(() => setState({ kind: "loading" }));

    (async () => {
      try {
        const res = await fetch("/api/portfolio-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: holdings, range }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        setState({
          kind: "loaded",
          data: (await res.json()) as PortfolioHistoryResponse,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
      }
    })();

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return state;
}
