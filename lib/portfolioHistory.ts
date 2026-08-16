import { fetchYahooChart } from "@/lib/yahoo";
import {
  buildPortfolioSeries,
  type HoldingHistory,
  type SeriesHolding,
} from "@/lib/portfolioSeries";
import type {
  HistoryPoint,
  PortfolioHistoryRange,
  PortfolioHistoryResponse,
} from "@/types";

// The single declaration of this union lives in types/index.ts — do not
// redeclare it here, or the endpoint and the response type can drift apart.
export const PORTFOLIO_HISTORY_RANGES: readonly PortfolioHistoryRange[] = [
  "1D",
  "1M",
  "3M",
  "YTD",
  "1Y",
] as const;

/**
 * The series values today's holdings backwards through time. It is not a
 * record of what the account was actually worth. Surfaced in the UI.
 */
export const PORTFOLIO_HISTORY_CAVEAT =
  "Portfolio history reflects your current holdings throughout the period. Past buys and sells aren't accounted for.";

// Kept identical to app/api/risk/route.ts so the two public computation
// endpoints accept exactly the same holdings.
const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const MAX_TICKERS = 60;

export function isPortfolioHistoryRange(
  v: unknown,
): v is PortfolioHistoryRange {
  return (
    typeof v === "string" &&
    (PORTFOLIO_HISTORY_RANGES as readonly string[]).includes(v)
  );
}

export function sanitizeHoldings(raw: unknown): SeriesHolding[] {
  if (!Array.isArray(raw)) return [];
  const out: SeriesHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const symbol =
      typeof obj.symbol === "string" ? obj.symbol.trim().toUpperCase() : null;
    if (!symbol || !SYMBOL_RE.test(symbol)) continue;
    const qty = typeof obj.quantity === "number" ? obj.quantity : null;
    if (qty == null || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ symbol, quantity: qty });
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

export async function buildPortfolioHistory(
  holdings: SeriesHolding[],
  range: PortfolioHistoryRange,
): Promise<PortfolioHistoryResponse> {
  const uniqueSymbols = Array.from(new Set(holdings.map((h) => h.symbol)));

  const fetched = await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      try {
        const res = await fetchYahooChart(symbol, range);
        return [symbol, res.points as HistoryPoint[]] as const;
      } catch {
        return [symbol, null] as const;
      }
    }),
  );

  const bySymbol = new Map<string, HistoryPoint[]>();
  const missing: string[] = [];
  for (const [symbol, points] of fetched) {
    if (points && points.length > 0) bySymbol.set(symbol, points);
    else missing.push(symbol);
  }

  const histories: HoldingHistory[] = holdings
    .filter((h) => bySymbol.has(h.symbol))
    .map((h) => ({ holding: h, points: bySymbol.get(h.symbol)! }));

  const points = buildPortfolioSeries(histories);

  return {
    range,
    points,
    startValue: points.length > 0 ? points[0].value : null,
    endValue: points.length > 0 ? points[points.length - 1].value : null,
    missing_symbols: missing,
    caveat: PORTFOLIO_HISTORY_CAVEAT,
  };
}
