"use client";

import { useSyncExternalStore } from "react";
import type { CompanyProfile } from "@/types";

type Listener = () => void;

const profiles = new Map<string, CompanyProfile>();
const inFlight = new Set<string>();
const listeners = new Map<string, Set<Listener>>();
const NEGATIVE: CompanyProfile = { symbol: "", logo: null, name: "" };

function notify(symbol: string) {
  const ls = listeners.get(symbol);
  if (ls) for (const l of ls) l();
}

async function fetchProfile(symbol: string): Promise<void> {
  if (inFlight.has(symbol) || profiles.has(symbol)) return;
  const token = process.env.NEXT_PUBLIC_FINNHUB_TOKEN;
  if (!token) return;
  inFlight.add(symbol);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`,
      { cache: "force-cache" },
    );
    let logo: string | null = null;
    let name = "";
    if (res.ok) {
      const data = await res.json();
      logo =
        typeof data?.logo === "string" && data.logo.startsWith("http")
          ? data.logo
          : null;
      name = typeof data?.name === "string" ? data.name : "";
    }
    if (!name) {
      name = await fetchSearchName(symbol, token);
    }
    profiles.set(symbol, { symbol, logo, name });
    notify(symbol);
  } catch {
    profiles.set(symbol, { symbol, logo: null, name: "" });
    notify(symbol);
  } finally {
    inFlight.delete(symbol);
  }
}

async function fetchSearchName(symbol: string, token: string): Promise<string> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(symbol)}&token=${token}`,
      { cache: "force-cache" },
    );
    if (!res.ok) return "";
    const data = await res.json();
    if (!Array.isArray(data?.result)) return "";
    const upper = symbol.toUpperCase();
    const match = data.result.find(
      (r: { symbol?: string; displaySymbol?: string; description?: string }) =>
        r?.symbol === upper || r?.displaySymbol === upper,
    );
    const desc = typeof match?.description === "string" ? match.description : "";
    return desc ? prettifyName(desc) : "";
  } catch {
    return "";
  }
}

const KEEP_UPPER = new Set([
  "ETF",
  "ETN",
  "ETP",
  "REIT",
  "USD",
  "S&P",
  "SPDR",
  "ESG",
  "AI",
  "US",
]);

function prettifyName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      const upper = w.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function subscribe(symbol: string, cb: Listener): () => void {
  let set = listeners.get(symbol);
  if (!set) {
    set = new Set();
    listeners.set(symbol, set);
  }
  set.add(cb);
  if (!profiles.has(symbol) && !inFlight.has(symbol)) {
    void fetchProfile(symbol);
  }
  return () => {
    const s = listeners.get(symbol);
    if (s) {
      s.delete(cb);
      if (s.size === 0) listeners.delete(symbol);
    }
  };
}

export function useCompanyProfile(symbol: string): CompanyProfile {
  return useSyncExternalStore(
    (cb) => subscribe(symbol, cb),
    () => profiles.get(symbol) ?? NEGATIVE,
    () => NEGATIVE,
  );
}

export function getProfileNameSync(symbol: string): string | undefined {
  return profiles.get(symbol)?.name || undefined;
}
