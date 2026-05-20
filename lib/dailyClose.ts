"use client";

import { useEffect, useState } from "react";

type Listener = () => void;

const closes = new Map<string, number>();
const inFlight = new Set<string>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

async function fetchClose(symbol: string): Promise<void> {
  if (closes.has(symbol) || inFlight.has(symbol)) return;
  const token = process.env.NEXT_PUBLIC_FINNHUB_TOKEN;
  if (!token) return;
  inFlight.add(symbol);
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${token}`,
      { cache: "no-store" },
    );
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.pc === "number" && data.pc > 0) {
      closes.set(symbol, data.pc);
      notify();
    }
  } catch {
    // ignore
  } finally {
    inFlight.delete(symbol);
  }
}

export function getDailyCloseSync(symbol: string): number | undefined {
  return closes.get(symbol);
}

export function useDailyCloseVersion(symbols: string[]): number {
  const [version, setVersion] = useState(0);
  const key = symbols.slice().sort().join("|");

  useEffect(() => {
    const cb = () => setVersion((v) => v + 1);
    listeners.add(cb);
    for (const s of symbols) void fetchClose(s);
    return () => {
      listeners.delete(cb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return version;
}
