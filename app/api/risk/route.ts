import { NextResponse } from "next/server";
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";
import {
  annualizedVolatility,
  beta,
  dailyReturns,
  maxDrawdown,
  sharpeRatio,
} from "@/lib/riskMetrics";
import type { HistoryPoint } from "@/types";

export const runtime = "nodejs";

const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const MAX_TICKERS = 60;
const BENCHMARK = "SPY";
const MIN_DAYS = 30;

type Holding = { symbol: string; quantity: number };

type RequestBody = {
  tickers?: unknown;
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

function sanitizeHoldings(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) return [];
  const out: Holding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const symbol =
      typeof obj.symbol === "string"
        ? obj.symbol.trim().toUpperCase()
        : null;
    if (!symbol || !SYMBOL_RE.test(symbol)) continue;
    const qty = typeof obj.quantity === "number" ? obj.quantity : null;
    if (qty == null || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ symbol, quantity: qty });
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

/**
 * Snap-to-prior portfolio valuation over a union of timestamps.  Same
 * algorithm as app/api/compare/route.ts:computePortfolioValues.
 */
function buildPortfolioSeries(
  times: number[],
  histories: { holding: Holding; points: HistoryPoint[] }[],
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

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const holdings = sanitizeHoldings(body.tickers);
  if (holdings.length === 0) {
    return NextResponse.json(
      { error: "No holdings with quantity to analyze" },
      { status: 400 },
    );
  }

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

  // Holdings with usable history.
  const usableHoldings = holdings.filter((h) =>
    historyBySymbol.has(h.symbol),
  );
  if (usableHoldings.length === 0) {
    return NextResponse.json(
      {
        error: "No price history available for these tickers",
        missing_symbols: missing,
      },
      { status: 502 },
    );
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

  // Daily returns of the portfolio.
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

  // Insufficient sample -> return nulls (UI shows "not enough history").
  if (portfolioReturns.length < MIN_DAYS) {
    const response: RiskResponse = {
      range: "1Y",
      sample_days: portfolioReturns.length,
      sharpe: null,
      beta: betaValue,
      volatility: null,
      max_drawdown: null,
      benchmark: BENCHMARK,
      ...(missing.length > 0 ? { missing_symbols: missing } : {}),
    };
    return NextResponse.json(response);
  }

  const sharpeVal = sharpeRatio(portfolioReturns);
  const volVal = annualizedVolatility(portfolioReturns);
  const ddVal = maxDrawdown(portfolioValues);

  const response: RiskResponse = {
    range: "1Y",
    sample_days: portfolioReturns.length,
    sharpe: Number.isFinite(sharpeVal) ? sharpeVal : null,
    beta: betaValue,
    volatility: Number.isFinite(volVal) ? volVal : null,
    max_drawdown: Number.isFinite(ddVal) ? ddVal : null,
    benchmark: BENCHMARK,
    ...(missing.length > 0 ? { missing_symbols: missing } : {}),
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, max-age=0, no-store" },
  });
}
