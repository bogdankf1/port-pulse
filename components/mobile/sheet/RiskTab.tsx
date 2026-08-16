"use client";

import { RiskGauge } from "../RiskGauge";
import { useRiskMetrics } from "@/hooks/useRiskMetrics";
import type { Ticker } from "@/types";

const GOOD = "bg-emerald-500/70";
const MID = "bg-amber-500/70";
const BAD = "bg-red-500/70";
const NEUTRAL = "bg-slate-300 dark:bg-slate-700";

type Props = { tickers: Ticker[] };

export function RiskTab({ tickers }: Props) {
  const state = useRiskMetrics(tickers);
  const hasQualifying = tickers.some(
    (t) => typeof t.quantity === "number" && t.quantity > 0,
  );

  if (!hasQualifying) {
    return (
      <p className="py-8 text-center font-mono text-xs text-slate-500">
        Add quantities to your holdings to see risk metrics.
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="py-8 text-center font-mono text-xs text-slate-500">
        Couldn&apos;t compute risk metrics — {state.message}.
      </p>
    );
  }

  const d = state.kind === "loaded" ? state.data : null;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Risk · 1Y
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-slate-500">
          {d ? `${d.sample_days}d sample` : "…"}
        </span>
      </div>

      <RiskGauge
        label="Sharpe"
        value={d?.sharpe ?? null}
        display={d?.sharpe != null ? d.sharpe.toFixed(2) : null}
        min={0}
        max={3}
        zones={[
          { upTo: 1, className: BAD },
          { upTo: 2, className: MID },
          { upTo: 3, className: GOOD },
        ]}
        scaleLabels={["0 poor", "1.5", "3 great"]}
        tone={
          d?.sharpe == null
            ? undefined
            : d.sharpe >= 1
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        }
        explanation="Return per unit of risk, after a 4% baseline. Above 1 is good, above 2 is excellent."
      />

      <RiskGauge
        label="Beta vs SPY"
        value={d?.beta ?? null}
        display={d?.beta != null ? d.beta.toFixed(2) : null}
        min={0}
        max={2}
        zones={[{ upTo: 2, className: NEUTRAL }]}
        tick={1}
        scaleLabels={["0 defensive", "1.0 market", "2 punchy"]}
        explanation="Sensitivity to S&P 500 moves. 1 means you move with the market. Higher is not worse — it is a choice about how much market exposure you want."
      />

      <RiskGauge
        label="Volatility"
        value={d?.volatility != null ? d.volatility * 100 : null}
        display={
          d?.volatility != null ? `${(d.volatility * 100).toFixed(1)}%` : null
        }
        min={0}
        max={40}
        zones={[
          { upTo: 15, className: GOOD },
          { upTo: 25, className: MID },
          { upTo: 40, className: BAD },
        ]}
        scaleLabels={["0% steady", "20%", "40% wild"]}
        explanation="Annualised standard deviation of daily returns. The bands assume a growth-heavy book — 20% is ordinary for tech and high for a bond-tilted portfolio."
      />

      <RiskGauge
        label="Max drawdown"
        value={d?.max_drawdown != null ? Math.abs(d.max_drawdown * 100) : null}
        display={
          d?.max_drawdown != null
            ? `${(d.max_drawdown * 100).toFixed(1)}%`
            : null
        }
        min={0}
        max={50}
        zones={[
          { upTo: 10, className: GOOD },
          { upTo: 20, className: MID },
          { upTo: 50, className: BAD },
        ]}
        scaleLabels={["0% mild", "-20%", "-50% brutal"]}
        tone={d?.max_drawdown == null ? undefined : "text-red-600 dark:text-red-400"}
        explanation="Worst peak-to-trough drop over the past year — the 'how bad did it actually get' number."
      />

      {d && d.missing_symbols && d.missing_symbols.length > 0 && (
        <p className="mt-3 font-mono text-[10px] text-slate-500">
          No history for {d.missing_symbols.join(", ")} — excluded.
        </p>
      )}
      {d && d.sample_days < 30 && (
        <p className="mt-2 font-mono text-[10px] text-slate-500">
          Only {d.sample_days} days of history — these are provisional.
        </p>
      )}
    </div>
  );
}
