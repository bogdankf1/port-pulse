import type { Ticker } from "@/types";
import { getUser, isAuthReady, subscribeUser } from "./auth";
import { isSupabaseConfigured } from "./supabase";
import {
  getActivePortfolioId,
  subscribeActivePortfolio,
} from "./portfolios";

const EMPTY: Ticker[] = [];

const subscribers = new Set<() => void>();
let cached: Ticker[] = EMPTY;
let initialized = false;
let lastUserId: string | null = null;
let lastPortfolioId: string | null = null;
let migrating = false;
let fetchSeq = 0;

function emit(): void {
  for (const sub of subscribers) sub();
}

async function fetchRemote(portfolioId: string): Promise<Ticker[] | null> {
  try {
    const res = await fetch(
      `/api/watchlist?portfolio_id=${encodeURIComponent(portfolioId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.tickers)) return null;
    return json.tickers as Ticker[];
  } catch {
    return null;
  }
}

async function postRemote(
  portfolioId: string,
  tickers: Ticker[],
): Promise<void> {
  if (tickers.length === 0) return;
  try {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolio_id: portfolioId, tickers }),
    });
  } catch {
    // ignore — UI shows the optimistic update; reload will resync
  }
}

async function deleteRemote(
  portfolioId: string,
  symbols?: string[],
): Promise<void> {
  try {
    const base = `/api/watchlist?portfolio_id=${encodeURIComponent(portfolioId)}`;
    const url =
      symbols && symbols.length > 0
        ? `${base}&symbols=${symbols.map(encodeURIComponent).join(",")}`
        : base;
    await fetch(url, { method: "DELETE" });
  } catch {
    // ignore
  }
}

function mergePair(a: Ticker, b: Ticker): Ticker {
  const aQty = a.quantity ?? 0;
  const bQty = b.quantity ?? 0;
  const totalQty = aQty + bQty;

  let entryPrice: number | undefined;
  if (a.entryPrice != null && b.entryPrice != null && totalQty > 0) {
    entryPrice = (aQty * a.entryPrice + bQty * b.entryPrice) / totalQty;
  } else if (a.entryPrice != null) {
    entryPrice = a.entryPrice;
  } else if (b.entryPrice != null) {
    entryPrice = b.entryPrice;
  }

  return {
    symbol: a.symbol,
    name: a.name || b.name,
    quantity: totalQty > 0 ? totalQty : a.quantity ?? b.quantity,
    entryPrice,
  };
}

function mergeArrays(existing: Ticker[], incoming: Ticker[]): Ticker[] {
  const indexBySymbol = new Map<string, number>();
  const out = existing.map((t, i) => {
    indexBySymbol.set(t.symbol, i);
    return t;
  });
  for (const t of incoming) {
    const idx = indexBySymbol.get(t.symbol);
    if (idx == null) {
      indexBySymbol.set(t.symbol, out.length);
      out.push(t);
    } else {
      out[idx] = mergePair(out[idx], t);
    }
  }
  return out;
}

async function reload(): Promise<void> {
  if (typeof window === "undefined") return;
  const u = getUser();
  const userId = u?.id ?? null;
  const portfolioId = getActivePortfolioId();

  // Logged out: drop everything (in-memory only, no persistence).
  if (!userId) {
    if (lastUserId !== null) {
      // Just signed out — clear cached state.
      lastUserId = null;
      lastPortfolioId = null;
      cached = EMPTY;
      emit();
    }
    return;
  }

  // Logged in but portfolio hasn't loaded yet — wait.
  if (!portfolioId) return;

  // Same user + same portfolio → nothing to do.
  if (userId === lastUserId && portfolioId === lastPortfolioId) return;

  // Just signed in (carrying in-memory tickers from a guest session)?
  const justSignedIn = lastUserId === null;
  const carry = justSignedIn ? cached : EMPTY;

  if (migrating) return;
  migrating = true;
  const seq = ++fetchSeq;
  try {
    lastUserId = userId;
    lastPortfolioId = portfolioId;

    const remote = await fetchRemote(portfolioId);
    if (seq !== fetchSeq) return; // newer reload superseded us
    const base = remote ?? EMPTY;
    const merged = carry.length > 0 ? mergeArrays(base, carry) : base;

    if (carry.length > 0) {
      const carrySyms = new Set(carry.map((t) => t.symbol));
      const toUpsert = merged.filter((t) => carrySyms.has(t.symbol));
      if (toUpsert.length > 0) await postRemote(portfolioId, toUpsert);
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

  if (isSupabaseConfigured()) {
    subscribeUser(() => {
      reload().catch(() => {});
    });
    if (isAuthReady()) {
      reload().catch(() => {});
    }
  }

  subscribeActivePortfolio(() => {
    reload().catch(() => {});
  });
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
  if (incoming.length === 0) return;
  const before = cached;
  const merged = mergeArrays(before, incoming);
  if (merged === before) return;
  cached = merged;
  emit();
  if (lastUserId && lastPortfolioId) {
    const touched = new Set(incoming.map((t) => t.symbol));
    const toPost = merged.filter((t) => touched.has(t.symbol));
    if (toPost.length > 0) void postRemote(lastPortfolioId, toPost);
  }
}

export function removeFromWatchlist(symbol: string): void {
  ensureInit();
  if (!cached.some((t) => t.symbol === symbol)) return;
  cached = cached.filter((t) => t.symbol !== symbol);
  emit();
  if (lastUserId && lastPortfolioId) {
    void deleteRemote(lastPortfolioId, [symbol]);
  }
}

export function clearWatchlist(): void {
  ensureInit();
  if (cached.length === 0) return;
  cached = EMPTY;
  emit();
  if (lastUserId && lastPortfolioId) {
    void deleteRemote(lastPortfolioId);
  }
}
