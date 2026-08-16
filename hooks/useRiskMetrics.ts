"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// MUST stay `import type`. lib/mcp/risk.ts begins with `import "server-only"`,
// which throws at build time if it reaches a client bundle. A type-only import
// is erased by TypeScript, so nothing is emitted — but dropping the `type`
// keyword here will break the build.
import type { RiskResult } from "@/lib/mcp/risk";
import type { Ticker } from "@/types";

export type RiskState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: RiskResult }
  | { kind: "error"; message: string };

// Risk metrics are computed from a year of daily closes — they do not move
// meaningfully within a session, and the endpoint fans out to Yahoo per
// symbol. Cache by holdings shape so reopening the tab is free.
const cache = new Map<string, RiskResult>();

function holdingsKey(holdings: { symbol: string; quantity: number }[]): string {
  return holdings
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((h) => `${h.symbol}:${h.quantity}`)
    .join("|");
}

export function useRiskMetrics(tickers: Ticker[]): RiskState {
  const qualifying = useMemo(
    () =>
      tickers
        .filter(
          (t): t is Ticker & { quantity: number } =>
            typeof t.quantity === "number" && t.quantity > 0,
        )
        .map((t) => ({ symbol: t.symbol, quantity: t.quantity })),
    [tickers],
  );

  const key = useMemo(() => holdingsKey(qualifying), [qualifying]);
  const [state, setState] = useState<RiskState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (qualifying.length === 0) {
      queueMicrotask(() => setState({ kind: "idle" }));
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      queueMicrotask(() => setState({ kind: "loaded", data: cached }));
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    queueMicrotask(() => setState({ kind: "loading" }));

    (async () => {
      try {
        const res = await fetch("/api/risk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: qualifying }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        const data = (await res.json()) as RiskResult;
        cache.set(key, data);
        setState({ kind: "loaded", data });
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
  }, [key]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return state;
}
