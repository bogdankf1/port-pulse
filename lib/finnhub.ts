"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ConnectionState, PriceState } from "@/types";

type Listener = () => void;

const prices = new Map<string, PriceState>();
const priceListeners = new Map<string, Set<Listener>>();
const connListeners = new Set<Listener>();

let ws: WebSocket | null = null;
let subs = new Set<string>();
let wanted = new Set<string>();
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;
let activeUsers = 0;
let connState: ConnectionState = "idle";

function notifyConn() {
  for (const l of connListeners) l();
}

function notifyPrice(symbol: string) {
  const ls = priceListeners.get(symbol);
  if (ls) for (const l of ls) l();
}

function setConnState(next: ConnectionState) {
  if (connState === next) return;
  connState = next;
  notifyConn();
}

function reconcile() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const sym of Array.from(subs)) {
    if (!wanted.has(sym)) {
      ws.send(JSON.stringify({ type: "unsubscribe", symbol: sym }));
      subs.delete(sym);
    }
  }
  for (const sym of wanted) {
    if (!subs.has(sym)) {
      ws.send(JSON.stringify({ type: "subscribe", symbol: sym }));
      subs.add(sym);
    }
  }
}

function connect() {
  if (ws) return;
  const token = process.env.NEXT_PUBLIC_FINNHUB_TOKEN;
  if (!token) {
    console.error("NEXT_PUBLIC_FINNHUB_TOKEN is not set");
    setConnState("closed");
    return;
  }
  setConnState("connecting");
  const socket = new WebSocket(`wss://ws.finnhub.io?token=${token}`);
  ws = socket;

  socket.addEventListener("open", () => {
    retries = 0;
    setConnState("open");
    subs = new Set();
    reconcile();
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data && data.type === "trade" && Array.isArray(data.data)) {
        for (const trade of data.data) {
          if (typeof trade?.s === "string" && typeof trade?.p === "number") {
            const prev = prices.get(trade.s);
            prices.set(trade.s, {
              price: trade.p,
              prevPrice: prev?.price ?? null,
              timestamp: Date.now(),
            });
            notifyPrice(trade.s);
          }
        }
      }
    } catch {
      // ignore malformed messages
    }
  });

  socket.addEventListener("close", () => {
    ws = null;
    subs = new Set();
    setConnState("closed");
    if (activeUsers > 0 && wanted.size > 0) scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    // close handler runs after error
  });
}

function scheduleReconnect() {
  if (retryTimer != null) return;
  const delay = Math.min(30000, 1000 * Math.pow(2, retries));
  retries += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);
}

function teardown() {
  if (retryTimer != null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  subs = new Set();
  wanted = new Set();
  retries = 0;
  setConnState("idle");
}

function scheduleTeardown() {
  if (teardownTimer != null) return;
  teardownTimer = setTimeout(() => {
    teardownTimer = null;
    if (activeUsers <= 0) teardown();
  }, 100);
}

function cancelTeardown() {
  if (teardownTimer != null) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
}

function subscribePrice(symbol: string, listener: Listener): () => void {
  let set = priceListeners.get(symbol);
  if (!set) {
    set = new Set();
    priceListeners.set(symbol, set);
  }
  set.add(listener);
  return () => {
    const s = priceListeners.get(symbol);
    if (s) {
      s.delete(listener);
      if (s.size === 0) priceListeners.delete(symbol);
    }
  };
}

function subscribeConn(listener: Listener): () => void {
  connListeners.add(listener);
  return () => {
    connListeners.delete(listener);
  };
}

export function useFinnhubPrices(symbols: string[]): ConnectionState {
  const key = symbols.slice().sort().join("|");

  useEffect(() => {
    cancelTeardown();
    activeUsers += 1;
    wanted = new Set(symbols);
    if (!ws) connect();
    else reconcile();
    return () => {
      activeUsers -= 1;
      if (activeUsers <= 0) scheduleTeardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useSyncExternalStore(
    subscribeConn,
    () => connState,
    () => "idle" as ConnectionState,
  );
}

export function usePrice(symbol: string): PriceState | undefined {
  return useSyncExternalStore(
    (listener) => subscribePrice(symbol, listener),
    () => prices.get(symbol),
    () => undefined,
  );
}
