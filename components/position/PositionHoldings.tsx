"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getUser,
  getUserServerSnapshot,
  isAuthReady,
  subscribeUser,
} from "@/lib/auth";
import { usePrice } from "@/lib/finnhub";
import {
  getWatchlist,
  getWatchlistServerSnapshot,
  subscribeWatchlist,
} from "@/lib/storage";
import {
  getActivePortfolioId,
  getActiveIdServerSnapshot,
  getPortfolios,
  getPortfoliosServerSnapshot,
  subscribeActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import type { PositionDetails, PositionPortfolioRow } from "@/types";

type Props = { symbol: string };

type RemoteSlot =
  | { kind: "loaded"; details: PositionDetails }
  | { kind: "missing" }
  | { kind: "error"; message: string };

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; details: PositionDetails }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "anon"; row: PositionPortfolioRow | null; name: string };

export function PositionHoldings({ symbol }: Props) {
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  const tickers = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlist,
    getWatchlistServerSnapshot,
  );
  const portfolios = useSyncExternalStore(
    subscribePortfolios,
    getPortfolios,
    getPortfoliosServerSnapshot,
  );
  const activeId = useSyncExternalStore(
    subscribeActivePortfolio,
    getActivePortfolioId,
    getActiveIdServerSnapshot,
  );

  const isLoggedIn = Boolean(user);
  const [remote, setRemote] = useState<{ key: string; slot: RemoteSlot } | null>(
    null,
  );
  const remoteKey = isLoggedIn ? symbol : null;

  // Signed-in branch: fetch /api/positions/[symbol]. setState is only invoked
  // inside async callbacks so it doesn't fire synchronously in the effect body.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (!isAuthReady()) return;
    const controller = new AbortController();
    const key = symbol;
    fetch(`/api/positions/${encodeURIComponent(symbol)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 404) {
          setRemote({ key, slot: { kind: "missing" } });
          return;
        }
        if (!res.ok) {
          const msg = await res
            .json()
            .then((j: { error?: string }) => j?.error)
            .catch(() => undefined);
          setRemote({
            key,
            slot: { kind: "error", message: msg || `Failed (${res.status})` },
          });
          return;
        }
        const details = (await res.json()) as PositionDetails;
        setRemote({ key, slot: { kind: "loaded", details } });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setRemote({ key, slot: { kind: "error", message: err.message } });
      });
    return () => controller.abort();
  }, [symbol, isLoggedIn]);

  let state: LoadState;
  if (isLoggedIn) {
    if (!remote || remote.key !== remoteKey) {
      state = { status: "loading" };
    } else if (remote.slot.kind === "loaded") {
      state = { status: "loaded", details: remote.slot.details };
    } else if (remote.slot.kind === "missing") {
      state = { status: "missing" };
    } else {
      state = { status: "error", message: remote.slot.message };
    }
  } else {
    const match = tickers.find((t) => t.symbol === symbol);
    if (!match) {
      state = { status: "anon", row: null, name: "" };
    } else {
      const activePortfolio = portfolios.find((p) => p.id === activeId);
      state = {
        status: "anon",
        name: match.name || "",
        row: {
          id: activeId || "local",
          name: activePortfolio?.name || "This session",
          quantity: match.quantity ?? null,
          entryPrice: match.entryPrice ?? null,
        },
      };
    }
  }

  return <HoldingsView symbol={symbol} state={state} />;
}

function HoldingsView({
  symbol,
  state,
}: {
  symbol: string;
  state: LoadState;
}) {
  const price = usePrice(symbol);
  const current = price?.price;

  if (state.status === "idle" || state.status === "loading") {
    return (
      <Shell>
        <div className="font-mono text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-600">
          Loading holdings…
        </div>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell>
        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
          Could not load holdings — {state.message}
        </div>
      </Shell>
    );
  }

  if (state.status === "missing") {
    return (
      <Shell>
        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
          You don&apos;t hold {symbol} in any portfolio.
        </div>
      </Shell>
    );
  }

  const rows: PositionPortfolioRow[] =
    state.status === "loaded"
      ? state.details.portfolios
      : state.row
        ? [state.row]
        : [];

  const totalQty = rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
  let costBasis = 0;
  let hasCost = false;
  for (const r of rows) {
    if (r.quantity != null && r.entryPrice != null) {
      costBasis += r.quantity * r.entryPrice;
      hasCost = true;
    }
  }
  const marketValue =
    current != null && totalQty > 0 ? current * totalQty : null;
  const pl =
    marketValue != null && hasCost ? marketValue - costBasis : null;
  const plPct =
    pl != null && hasCost && costBasis > 0 ? (pl / costBasis) * 100 : null;
  const plPositive = pl != null && pl >= 0;
  const plColor =
    pl == null
      ? "text-slate-500"
      : plPositive
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  const showRows = rows.length > 0 && rows.some((r) => r.quantity != null);

  return (
    <Shell>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total qty"
          value={
            totalQty > 0 ? formatQty(totalQty) : <Em>—</Em>
          }
        />
        <Stat
          label="Market value"
          value={
            marketValue != null ? `$${formatMoney(marketValue)}` : <Em>—</Em>
          }
        />
        <Stat
          label="Cost basis"
          value={hasCost ? `$${formatMoney(costBasis)}` : <Em>—</Em>}
        />
        <Stat
          label="P&L"
          valueClass={plColor}
          value={
            pl != null ? (
              <>
                <div>
                  {plPositive ? "+" : "−"}${formatMoney(Math.abs(pl))}
                </div>
                {plPct != null && (
                  <div className="text-[10px] opacity-80">
                    {plPositive ? "+" : "−"}
                    {Math.abs(plPct).toFixed(2)}%
                  </div>
                )}
              </>
            ) : (
              <Em>—</Em>
            )
          }
        />
      </div>

      {showRows && (
        <div className="mt-4 overflow-hidden border-t border-slate-200 dark:border-slate-800/70 sm:rounded-lg sm:border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-800/70 dark:bg-slate-900/60">
                <th className="py-2 pl-3 pr-2 text-left font-medium">
                  Portfolio
                </th>
                <th className="px-2 py-2 text-right font-medium">Qty</th>
                <th className="px-2 py-2 text-right font-medium">Entry</th>
                <th className="px-2 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v =
                  current != null && r.quantity != null
                    ? current * r.quantity
                    : null;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/70"
                  >
                    <td className="py-2 pl-3 pr-2 text-slate-700 dark:text-slate-200">
                      {r.name}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {r.quantity != null ? formatQty(r.quantity) : <Em>—</Em>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {r.entryPrice != null ? `$${r.entryPrice.toFixed(2)}` : <Em>—</Em>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {v != null ? `$${formatMoney(v)}` : <Em>—</Em>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-200 px-4 pb-5 dark:border-slate-800/70 sm:rounded-xl sm:border sm:bg-white/60 sm:p-5 sm:dark:bg-slate-900/40">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500">
        Holdings
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100 ${valueClass ?? ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-400 dark:text-slate-600">{children}</span>;
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}
