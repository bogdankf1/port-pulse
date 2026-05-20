"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type Listener = () => void;

type CacheEntry = {
  value: string | null;
  fetchedAt: number;
};

const STORAGE_KEY = "pp:sectors:v2";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sectors = new Map<string, string | null>();
const listeners = new Map<string, Set<Listener>>();
const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

function notify(symbol: string) {
  const ls = listeners.get(symbol);
  if (ls) for (const l of ls) l();
}

function hydrateFromStorage() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [sym, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== "object") continue;
      if (now - entry.fetchedAt > TTL_MS) continue;
      sectors.set(sym, entry.value);
    }
  } catch {
    // ignore
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const out: Record<string, CacheEntry> = {};
    const now = Date.now();
    for (const [sym, value] of sectors) {
      // Skip nulls — they represent "unknown" and should be retried in a
      // future session in case the classifier improves (Claude fallback, etc.).
      if (value == null) continue;
      out[sym] = { value, fetchedAt: now };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // ignore
  }
}

async function flushBatch() {
  flushTimer = null;
  const batch = Array.from(pending);
  pending.clear();
  if (batch.length === 0) return;
  try {
    const res = await fetch(
      `/api/sectors?symbols=${encodeURIComponent(batch.join(","))}`,
      { cache: "force-cache" },
    );
    if (!res.ok) {
      for (const sym of batch) {
        if (!sectors.has(sym)) sectors.set(sym, null);
        notify(sym);
      }
      return;
    }
    const json = (await res.json()) as { sectors: Record<string, string | null> };
    for (const sym of batch) {
      const value = json.sectors?.[sym] ?? null;
      sectors.set(sym, value);
      notify(sym);
    }
    persist();
  } catch {
    for (const sym of batch) {
      if (!sectors.has(sym)) sectors.set(sym, null);
      notify(sym);
    }
  }
}

function ensureFetched(symbol: string) {
  if (sectors.has(symbol) || pending.has(symbol)) return;
  pending.add(symbol);
  if (flushTimer == null) {
    flushTimer = setTimeout(flushBatch, 50);
  }
}

function subscribe(symbol: string, cb: Listener): () => void {
  hydrateFromStorage();
  let set = listeners.get(symbol);
  if (!set) {
    set = new Set();
    listeners.set(symbol, set);
  }
  set.add(cb);
  ensureFetched(symbol);
  return () => {
    const s = listeners.get(symbol);
    if (s) {
      s.delete(cb);
      if (s.size === 0) listeners.delete(symbol);
    }
  };
}

export function useSector(symbol: string): string | null {
  return useSyncExternalStore(
    (cb) => subscribe(symbol, cb),
    () => {
      hydrateFromStorage();
      return sectors.get(symbol) ?? null;
    },
    () => null,
  );
}

export function getSectorSync(symbol: string): string | null {
  hydrateFromStorage();
  return sectors.get(symbol) ?? null;
}

export function useSectorsVersion(symbols: string[]): number {
  const [version, setVersion] = useState(0);
  const key = symbols.slice().sort().join("|");

  useEffect(() => {
    hydrateFromStorage();
    const unsubs = symbols.map((s) =>
      subscribe(s, () => setVersion((v) => v + 1)),
    );
    return () => {
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return version;
}
