import "server-only";
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";
import {
  annualizedVolatility,
  beta,
  dailyReturns,
  maxDrawdown,
  sharpeRatio,
} from "@/lib/riskMetrics";
import type { HistoryPoint } from "@/types";

/**
 * Shared by app/api/risk/route.ts and the get_risk_metrics MCP tool.
 *
 * Both callers must report the same Sharpe, beta, volatility and max drawdown
 * for the same portfolio, so this is imported by both rather than reimplemented:
 * two copies of a metric drift, and then the connector and the in-app panel
 * disagree about the same holdings.
 */

export const BENCHMARK = "SPY";
export const MIN_DAYS = 30;

export type RiskHolding = { symbol: string; quantity: number };

export type RiskResult = {
  range: "1Y";
  sample_days: number;
  sharpe: number | null;
  beta: number | null;
  volatility: number | null;
  max_drawdown: number | null;
  benchmark: string;
  missing_symbols?: string[];
};

/** No holding had usable price history — distinct from "not enough history". */
export class RiskDataUnavailableError extends Error {
  readonly missingSymbols: string[];
  constructor(missingSymbols: string[]) {
    super("No price history available for these tickers");
    this.name = "RiskDataUnavailableError";
    this.missingSymbols = missingSymbols;
  }
}

/**
 * Snap-to-prior portfolio valuation over a union of timestamps. Same
 * algorithm as app/api/compare/route.ts:computePortfolioValues.
 */
function buildPortfolioSeries(
  times: number[],
  histories: { holding: RiskHolding; points: HistoryPoint[] }[],
): { time: number; value: number }[] {
  const pointers = new Map<string, number>();
  for (const h of histories) pointers.set(h.holding.symbol, 0);

  const out: { time: number; value: number }[] = [];
  for (const t of times) {
    let total = 0;
    let allPriced = true;
    for (const sh of histories) {
      const pts = sh.points;
      let i = pointers.get(sh.holding.symbol) ?? 0;
      while (i + 1 < pts.length && pts[i + 1].time <= t) i++;
      pointers.set(sh.holding.symbol, i);
      const price = pts[i]?.time <= t ? pts[i]?.value : undefined;
      if (typeof price !== "number" || !Number.isFinite(price)) {
        allPriced = false;
        break;
      }
      total += sh.holding.quantity * price;
    }
    if (allPriced && Number.isFinite(total)) {
      out.push({ time: t, value: total });
    }
  }
  return out;
}

export async function computePortfolioRisk(
  holdings: RiskHolding[],
): Promise<RiskResult> {
  // Fetch 1Y history for every unique symbol (holdings + benchmark).
  const uniqueSymbols = Array.from(
    new Set<string>([...holdings.map((h) => h.symbol), BENCHMARK]),
  );

  type HistoryEntry =
    | { sym: string; points: HistoryPoint[] }
    | { sym: string; points: null; error: string };

  const histories: HistoryEntry[] = await Promise.all(
    uniqueSymbols.map(async (sym): Promise<HistoryEntry> => {
      try {
        const res = await fetchYahooChart(sym, "1Y");
        return { sym, points: res.points };
      } catch (err) {
        const msg = err instanceof YahooFetchError ? err.message : "fetch_failed";
        return { sym, points: null, error: msg };
      }
    }),
  );

  const historyBySymbol = new Map<string, HistoryPoint[]>();
  const missing: string[] = [];
  for (const h of histories) {
    if (h.points && h.points.length > 0) {
      historyBySymbol.set(h.sym, h.points);
    } else {
      missing.push(h.sym);
    }
  }

  const usableHoldings = holdings.filter((h) => historyBySymbol.has(h.symbol));
  if (usableHoldings.length === 0) {
    throw new RiskDataUnavailableError(missing);
  }

  // Build portfolio value series — start from the latest first-point time
  // across the usable holdings so every point is fully priced.
  const symbolHistories = usableHoldings.map((h) => ({
    holding: h,
    points: historyBySymbol.get(h.symbol)!,
  }));
  const latestStart = symbolHistories.reduce(
    (acc, s) => Math.max(acc, s.points[0].time),
    0,
  );

  const timeSet = new Set<number>();
  for (const s of symbolHistories) {
    for (const p of s.points) {
      if (p.time >= latestStart) timeSet.add(p.time);
    }
  }
  const times = Array.from(timeSet).sort((a, b) => a - b);
  const series = buildPortfolioSeries(times, symbolHistories);

  const portfolioValues = series.map((p) => p.value);
  const portfolioReturns = dailyReturns(portfolioValues);

  // SPY daily returns aligned to the same time window.
  const spyPoints = historyBySymbol.get(BENCHMARK);
  let betaValue: number | null = null;
  if (spyPoints && spyPoints.length > 1 && series.length > 1) {
    const spyByTime = new Map<number, number>();
    for (const p of spyPoints) spyByTime.set(p.time, p.value);
    const spyAligned: number[] = [];
    const portAligned: number[] = [];
    for (let i = 0; i < series.length; i++) {
      const s = spyByTime.get(series[i].time);
      if (typeof s !== "number") continue;
      spyAligned.push(s);
      portAligned.push(series[i].value);
    }
    if (spyAligned.length >= 2) {
      const spyRet = dailyReturns(spyAligned);
      const portRet = dailyReturns(portAligned);
      const b = beta(portRet, spyRet);
      betaValue = Number.isFinite(b) ? b : null;
    }
  }

  // Insufficient sample -> nulls (UI shows "not enough history").
  if (portfolioReturns.length < MIN_DAYS) {
    return {
      range: "1Y",
      sample_days: portfolioReturns.length,
      sharpe: null,
      beta: betaValue,
      volatility: null,
      max_drawdown: null,
      benchmark: BENCHMARK,
      ...(missing.length > 0 ? { missing_symbols: missing } : {}),
    };
  }

  const sharpeVal = sharpeRatio(portfolioReturns);
  const volVal = annualizedVolatility(portfolioReturns);
  const ddVal = maxDrawdown(portfolioValues);

  return {
    range: "1Y",
    sample_days: portfolioReturns.length,
    sharpe: Number.isFinite(sharpeVal) ? sharpeVal : null,
    beta: betaValue,
    volatility: Number.isFinite(volVal) ? volVal : null,
    max_drawdown: Number.isFinite(ddVal) ? ddVal : null,
    benchmark: BENCHMARK,
    ...(missing.length > 0 ? { missing_symbols: missing } : {}),
  };
}
