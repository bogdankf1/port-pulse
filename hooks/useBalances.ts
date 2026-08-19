"use client";

import { useCallback, useEffect, useState } from "react";
import type { Balance } from "@/types";

export type BalancesState = {
  balances: Balance[];
  rates: Record<string, number>;
  totalUsd: number;
  /** Currencies whose rate could not be fetched, so `totalUsd` is understated. */
  missingRates: string[];
  loading: boolean;
  refresh: () => Promise<void>;
};

const EMPTY: Balance[] = [];

/**
 * Balances change when a file is uploaded and at no other time, so this is a
 * plain fetch-on-mount hook rather than another `useSyncExternalStore` store.
 * Conversion happens server-side, so the rate used is the same one the
 * assistant and any other consumer would see.
 */
export function useBalances(enabled: boolean): BalancesState {
  const [balances, setBalances] = useState<Balance[]>(EMPTY);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [totalUsd, setTotalUsd] = useState(0);
  const [missingRates, setMissingRates] = useState<string[]>([]);
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/balances");
      if (!res.ok) return;
      const json = (await res.json()) as {
        balances: Balance[];
        rates: Record<string, number>;
        total_usd: number;
        missing_rates: string[];
      };
      setBalances(json.balances ?? EMPTY);
      setRates(json.rates ?? {});
      setTotalUsd(json.total_usd ?? 0);
      setMissingRates(json.missing_rates ?? []);
    } catch {
      // A failed load leaves the section empty, which reads the same as having
      // no balances — acceptable, since nothing else depends on it.
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // setState only inside the async callback, so it never fires synchronously
    // in the effect body.
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  return { balances, rates, totalUsd, missingRates, loading, refresh: load };
}
