"use client";

import { useEffect, useState } from "react";

export type SearchResult = {
  symbol: string;
  description: string;
  type: string;
  displaySymbol: string;
};

type FinnhubSearchResponse = {
  count?: number;
  result?: Array<{
    description?: string;
    displaySymbol?: string;
    symbol?: string;
    type?: string;
  }>;
};

export type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; results: SearchResult[] }
  | { status: "error"; query: string; message: string };

const DEBOUNCE_MS = 200;
const MAX_RESULTS = 8;
// Mirror the watchlist-route regex — anything we can't persist is useless here.
const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

/**
 * Instrument types that are not a holding. Everything else is offered.
 *
 * Deliberately a deny-list. The allow-list this replaces admitted only
 * "Common Stock", which meant every ETF — Finnhub types them "ETP" — was
 * dropped from the only manual add path in the app, even though `sectorMap`
 * maps SPY, VOO, IVV, VTI and QQQ by name and every risk metric benchmarks
 * against SPY. An allow-list fails closed on any type it has not heard of, and
 * that failure is silent; a deny-list surfaces the unknown instead.
 */
const NON_HOLDING_TYPES: ReadonlySet<string> = new Set([
  "warrant",
  "right",
  "unit",
]);

export function isTradableType(type: string): boolean {
  return !NON_HOLDING_TYPES.has(type.trim().toLowerCase());
}

export function useTickerSearch(rawQuery: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    const query = rawQuery.trim();
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      if (query.length < 1) {
        setState({ status: "idle" });
        return;
      }

      const token = process.env.NEXT_PUBLIC_FINNHUB_TOKEN;
      if (!token) {
        setState({
          status: "error",
          query,
          message: "Search is not configured (missing Finnhub token).",
        });
        return;
      }

      setState({ status: "loading", query });
      try {
        const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(token)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const json = (await res.json()) as FinnhubSearchResponse;
        const raw = Array.isArray(json.result) ? json.result : [];
        const results: SearchResult[] = [];
        for (const r of raw) {
          if (!r || typeof r !== "object") continue;
          const sym = (r.symbol || "").toString().trim().toUpperCase();
          const display = (r.displaySymbol || sym)
            .toString()
            .trim()
            .toUpperCase();
          const description = (r.description || "").toString();
          const type = (r.type || "").toString();
          if (!sym || !SYMBOL_RE.test(sym)) continue;
          if (!isTradableType(type)) continue;
          results.push({
            symbol: sym,
            displaySymbol: display,
            description,
            type,
          });
          if (results.length >= MAX_RESULTS) break;
        }
        setState({ status: "ready", query, results });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState({
          status: "error",
          query,
          message: (err as Error).message || "Search failed",
        });
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [rawQuery]);

  return state;
}

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_RE.test(symbol);
}
