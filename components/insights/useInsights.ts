"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InsightsSectionKey, Ticker } from "@/types";
import { getPriceSync } from "@/lib/finnhub";
import {
  SESSION_PREFIX,
  emptySections,
  hashHoldings,
  makeSectionStream,
  readCache,
  toResponse,
  writeCache,
} from "./stream";

type Params = {
  open: boolean;
  tickers: Ticker[];
  portfolioName: string;
  portfolioId: string | null;
};

// Owns the insights request lifecycle: session cache, streaming fetch, and the
// derived section state. Kicks off automatically when the drawer opens.
export function useInsights({
  open,
  tickers,
  portfolioName,
  portfolioId,
}: Params) {
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<Record<InsightsSectionKey, string>>(
    emptySections,
  );
  const [activeKey, setActiveKey] = useState<InsightsSectionKey | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tickersHash = useMemo(() => hashHoldings(tickers), [tickers]);
  const cacheKey = useMemo(
    () => `${SESSION_PREFIX}:${portfolioId ?? "anon"}:${tickersHash}`,
    [portfolioId, tickersHash],
  );

  const fetchInsights = useCallback(
    async (skipCache: boolean) => {
      if (!skipCache) {
        const cached = readCache(cacheKey);
        if (cached) {
          setSections({
            concentration_risk: cached.insights.concentration_risk ?? "",
            sector_tilt: cached.insights.sector_tilt ?? "",
            winners: cached.insights.winners ?? "",
            losers: cached.insights.losers ?? "",
            suggestion: cached.insights.suggestion ?? "",
          });
          setActiveKey(null);
          setGeneratedAt(cached.generatedAt);
          setError(null);
          return;
        }
      }

      const payload = tickers
        .map((t) => {
          const price = getPriceSync(t.symbol);
          if (price == null || t.quantity == null) return null;
          return {
            symbol: t.symbol,
            name: t.name,
            quantity: t.quantity,
            entryPrice: t.entryPrice ?? null,
            currentPrice: price,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v != null);

      if (payload.length === 0) {
        setError("No holdings with quantity and live price to analyze.");
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      setSections(emptySections());
      setActiveKey(null);
      setGeneratedAt(null);

      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers: payload,
            portfolioName,
            portfolioId,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (!res.body) {
          throw new Error("No response body");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = makeSectionStream();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          parser.ingest(text);
          const snap = parser.snapshot();
          if (snap.error) {
            throw new Error(snap.error);
          }
          setSections({ ...snap.sections });
          setActiveKey(snap.currentKey);
        }

        const final = parser.finish();
        if (final.error) {
          throw new Error(final.error);
        }
        const response = toResponse(final.sections);
        const generated = Date.now();
        setSections({ ...final.sections });
        setActiveKey(null);
        setGeneratedAt(generated);
        writeCache(cacheKey, { insights: response, generatedAt: generated });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load insights");
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setLoading(false);
      }
    },
    [cacheKey, portfolioId, portfolioName, tickers],
  );

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void fetchInsights(false));
  }, [open, fetchInsights]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    loading,
    sections,
    activeKey,
    generatedAt,
    error,
    regenerate: fetchInsights,
  };
}
