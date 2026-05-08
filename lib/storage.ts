import type { Ticker } from "@/types";
import { getUser, isAuthReady, subscribeUser } from "./auth";
import { isSupabaseConfigured } from "./supabase";

const KEY = "port-pulse:watchlist";
const EMPTY: Ticker[] = [];

const subscribers = new Set<() => void>();
let cached: Ticker[] = EMPTY;
let initialized = false;
let lastUserId: string | null = null;
let migrating = false;

function readFromSession(): Ticker[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const valid: Ticker[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { symbol?: unknown }).symbol === "string" &&
        (item as { symbol: string }).symbol.length > 0
      ) {
        const sym = (item as { symbol: string }).symbol;
        const rawName = (item as { name?: unknown }).name;
        valid.push({
          symbol: sym,
          name: typeof rawName === "string" ? rawName : "",
        });
      }
    }
    return valid.length > 0 ? valid : EMPTY;
  } catch {
    return EMPTY;
  }
}

function emit(): void {
  for (const sub of subscribers) sub();
}

function persistSession(tickers: Ticker[]): void {
  if (typeof window === "undefined") return;
  if (tickers.length === 0) sessionStorage.removeItem(KEY);
  else sessionStorage.setItem(KEY, JSON.stringify(tickers));
}

async function fetchRemote(): Promise<Ticker[] | null> {
  try {
    const res = await fetch("/api/watchlist", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.tickers)) return null;
    return json.tickers as Ticker[];
  } catch {
    return null;
  }
}

async function postRemote(tickers: Ticker[]): Promise<void> {
  if (tickers.length === 0) return;
  try {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });
  } catch {
    // ignore — UI shows the optimistic update; reload will resync
  }
}

async function deleteRemote(symbols?: string[]): Promise<void> {
  try {
    const url =
      symbols && symbols.length > 0
        ? `/api/watchlist?symbols=${symbols.map(encodeURIComponent).join(",")}`
        : "/api/watchlist";
    await fetch(url, { method: "DELETE" });
  } catch {
    // ignore
  }
}

function mergeArrays(existing: Ticker[], incoming: Ticker[]): Ticker[] {
  const seen = new Set(existing.map((t) => t.symbol));
  const out = existing.slice();
  for (const t of incoming) {
    if (!seen.has(t.symbol)) {
      out.push(t);
      seen.add(t.symbol);
    }
  }
  return out;
}

async function onAuthChange(): Promise<void> {
  if (typeof window === "undefined") return;
  const u = getUser();
  const newId = u?.id ?? null;
  if (newId === lastUserId) return;

  if (newId === null) {
    lastUserId = null;
    persistSession(cached);
    return;
  }

  if (migrating) return;
  migrating = true;
  try {
    lastUserId = newId;
    const sessionTickers = readFromSession();
    const remoteTickers = await fetchRemote();
    if (remoteTickers === null) {
      // Remote unavailable; treat as empty for now
      cached = sessionTickers;
      emit();
      return;
    }
    const merged = mergeArrays(remoteTickers, sessionTickers);
    if (sessionTickers.length > 0) {
      const remoteSyms = new Set(remoteTickers.map((t) => t.symbol));
      const newOnes = sessionTickers.filter((t) => !remoteSyms.has(t.symbol));
      if (newOnes.length > 0) {
        await postRemote(newOnes);
      }
      sessionStorage.removeItem(KEY);
    }
    cached = merged;
    emit();
  } finally {
    migrating = false;
  }
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  cached = readFromSession();

  window.addEventListener("storage", (e) => {
    if (e.key === KEY && !lastUserId) {
      cached = readFromSession();
      emit();
    }
  });

  if (isSupabaseConfigured()) {
    subscribeUser(() => {
      onAuthChange().catch(() => {});
    });
    if (isAuthReady()) {
      onAuthChange().catch(() => {});
    }
  }
}

export function getWatchlist(): Ticker[] {
  ensureInit();
  return cached;
}

export function getWatchlistServerSnapshot(): Ticker[] {
  return EMPTY;
}

export function subscribeWatchlist(cb: () => void): () => void {
  ensureInit();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function mergeIntoWatchlist(incoming: Ticker[]): void {
  ensureInit();
  const seen = new Set(cached.map((t) => t.symbol));
  const newOnes = incoming.filter((t) => !seen.has(t.symbol));
  if (newOnes.length === 0) return;
  cached = [...cached, ...newOnes];
  emit();
  if (lastUserId) {
    void postRemote(newOnes);
  } else {
    persistSession(cached);
  }
}

export function removeFromWatchlist(symbol: string): void {
  ensureInit();
  if (!cached.some((t) => t.symbol === symbol)) return;
  cached = cached.filter((t) => t.symbol !== symbol);
  emit();
  if (lastUserId) {
    void deleteRemote([symbol]);
  } else {
    persistSession(cached);
  }
}

export function clearWatchlist(): void {
  ensureInit();
  if (cached.length === 0) return;
  cached = EMPTY;
  emit();
  if (lastUserId) {
    void deleteRemote();
  } else {
    persistSession(EMPTY);
  }
}
