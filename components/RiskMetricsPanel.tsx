"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Ticker } from "@/types";

type Props = {
  tickers: Ticker[];
};

type RiskResponse = {
  range: "1Y";
  sample_days: number;
  sharpe: number | null;
  beta: number | null;
  volatility: number | null;
  max_drawdown: number | null;
  benchmark: string;
  missing_symbols?: string[];
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: RiskResponse }
  | { kind: "error"; message: string };

function holdingsKey(tickers: Ticker[]): string {
  // Stable key over the set of {symbol, quantity}. Re-fetch only when shape changes.
  return tickers
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((t) => `${t.symbol}:${t.quantity ?? "_"}`)
    .join("|");
}

export function RiskMetricsPanel({ tickers }: Props) {
  const qualifying = useMemo(
    () =>
      tickers
        .filter((t): t is Ticker & { quantity: number } => {
          return typeof t.quantity === "number" && t.quantity > 0;
        })
        .map((t) => ({ symbol: t.symbol, quantity: t.quantity })),
    [tickers],
  );
  const key = useMemo(
    () => holdingsKey(qualifying as unknown as Ticker[]),
    [qualifying],
  );

  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (qualifying.length === 0) {
      queueMicrotask(() => setState({ kind: "idle" }));
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    queueMicrotask(() => setState({ kind: "loading" }));

    (async () => {
      try {
        const res = await fetch("/api/risk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: qualifying }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(j.error || `Request failed (${res.status})`);
        }
        const data = (await res.json()) as RiskResponse;
        setState({ kind: "loaded", data });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
      }
    })();

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (qualifying.length === 0) return null;

  return (
    <section className="mb-4 border-b border-slate-200 px-4 pb-5 dark:border-slate-800/70 sm:mb-5 sm:rounded-xl sm:border sm:bg-white/60 sm:p-5 sm:dark:bg-slate-900/40">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
          Risk metrics
        </h2>
        <RangeBadge state={state} />
      </div>
      <Grid>
        <Tile
          label="Sharpe"
          tooltip="Return per unit of risk, after a 4% baseline. >1 is good, >2 is excellent."
          value={renderNumber(state, (d) => d.sharpe, formatNumber)}
          tone={(d) =>
            d.sharpe == null ? "neutral" : d.sharpe >= 1 ? "good" : "bad"
          }
          state={state}
        />
        <Tile
          label="Beta vs SPY"
          tooltip="Sensitivity to S&P 500 moves. 1 = same as market. >1 = more volatile, <1 = defensive."
          value={renderNumber(state, (d) => d.beta, formatNumber)}
          tone={() => "neutral"}
          state={state}
        />
        <Tile
          label="Volatility"
          tooltip="Annualized standard deviation of daily returns. Lower is steadier."
          value={renderNumber(
            state,
            (d) => d.volatility,
            (v) => `${(v * 100).toFixed(1)}%`,
          )}
          tone={() => "neutral"}
          state={state}
        />
        <Tile
          label="Max drawdown"
          tooltip="Worst peak-to-trough drop in the past year. The 'how bad could it get' number."
          value={renderNumber(
            state,
            (d) => d.max_drawdown,
            (v) => `${(v * 100).toFixed(1)}%`,
          )}
          tone={(d) =>
            d.max_drawdown == null
              ? "neutral"
              : d.max_drawdown >= -0.1
                ? "good"
                : d.max_drawdown >= -0.2
                  ? "neutral"
                  : "bad"
          }
          state={state}
        />
      </Grid>
      {state.kind === "loaded" &&
        state.data.missing_symbols &&
        state.data.missing_symbols.length > 0 && (
          <div className="mt-3 font-mono text-[10px] text-slate-500 dark:text-slate-500">
            No history available for {state.data.missing_symbols.join(", ")} —
            excluded from these numbers.
          </div>
        )}
      {state.kind === "loaded" && state.data.sample_days < 30 && (
        <div className="mt-3 font-mono text-[10px] text-slate-500 dark:text-slate-500">
          Only {state.data.sample_days} days of history — metrics are
          provisional.
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-3 font-mono text-[10px] text-slate-500 dark:text-slate-500">
          Couldn&apos;t compute risk metrics — {state.message}.
        </div>
      )}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {children}
    </div>
  );
}

type Tone = "good" | "bad" | "neutral";

function Tile({
  label,
  tooltip,
  value,
  tone,
  state,
}: {
  label: string;
  tooltip: string;
  value: React.ReactNode;
  tone: (data: RiskResponse) => Tone;
  state: LoadState;
}) {
  const t: Tone = state.kind === "loaded" ? tone(state.data) : "neutral";
  const toneClass =
    t === "good"
      ? "text-emerald-700 dark:text-emerald-400"
      : t === "bad"
        ? "text-red-700 dark:text-red-400"
        : "text-slate-900 dark:text-slate-100";

  return (
    <div className="rounded-md bg-slate-100/70 px-3 py-2 dark:bg-slate-800/50">
      <div
        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400"
        title={tooltip}
      >
        <span>{label}</span>
        <InfoIcon />
      </div>
      <div
        className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${toneClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function RangeBadge({ state }: { state: LoadState }) {
  const label =
    state.kind === "loaded"
      ? `1Y · ${state.data.sample_days}d`
      : state.kind === "loading"
        ? "1Y · …"
        : "1Y";
  return (
    <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
      {label}
    </span>
  );
}

function renderNumber(
  state: LoadState,
  pick: (data: RiskResponse) => number | null,
  format: (v: number) => string,
): React.ReactNode {
  if (state.kind === "loading" || state.kind === "idle") {
    return <Skeleton />;
  }
  if (state.kind === "error") {
    return <Em>—</Em>;
  }
  const v = pick(state.data);
  if (v == null || !Number.isFinite(v)) return <Em>—</Em>;
  return format(v);
}

function formatNumber(v: number): string {
  return v.toFixed(2);
}

function Skeleton() {
  return (
    <span className="inline-block h-4 w-12 animate-pulse rounded bg-slate-200 align-middle dark:bg-slate-700" />
  );
}

function Em({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-slate-400 dark:text-slate-600">{children}</span>
  );
}

function InfoIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="opacity-50"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
