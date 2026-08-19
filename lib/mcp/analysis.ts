import "server-only";
import { z } from "zod";
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";
import {
  buildPortfolioHistory,
  PORTFOLIO_HISTORY_CAVEAT,
  PORTFOLIO_HISTORY_RANGES,
} from "@/lib/portfolioHistory";
import {
  alignByTime,
  covariance,
  dailyReturns,
  stdDev,
} from "@/lib/riskMetrics";
import type { HistoryPoint, PortfolioHistoryRange } from "@/types";
import type { McpAuthContext } from "./auth";
import { MAX_SYMBOLS, SYMBOL_RE } from "./config";
import { createUserClient } from "./supabase";
import { usdRates } from "./fx";
import { toUsd, totalUsd } from "@/lib/balances";

/**
 * Portfolio-derived analysis. Each of these reuses the exact module the UI
 * already renders from — `buildPortfolioHistory` for the hero chart, the
 * `riskMetrics` primitives for the risk panel — so the assistant and the screen
 * can never quote different numbers for the same question.
 */

const rangeField = z
  .enum(
    PORTFOLIO_HISTORY_RANGES as unknown as [
      PortfolioHistoryRange,
      ...PortfolioHistoryRange[],
    ],
  )
  .describe("Time window.");

async function loadHoldings(ctx: McpAuthContext, portfolioId: string) {
  const supabase = createUserClient(ctx);
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("symbol, quantity")
    .eq("portfolio_id", portfolioId)
    .eq("user_id", ctx.userId);
  if (error) throw new Error(`Failed to load holdings: ${error.message}`);
  return (data ?? [])
    .map((r) => ({
      symbol: r.symbol as string,
      quantity: (r.quantity as number | null) ?? 0,
    }))
    .filter((h) => h.quantity > 0)
    .slice(0, MAX_SYMBOLS);
}

/* -------------------------------------------------- portfolio value history */

export const getPortfolioHistorySchema = z.object({
  portfolio_id: z.string().uuid(),
  range: rangeField,
});

export async function getPortfolioHistory(
  ctx: McpAuthContext,
  args: { portfolio_id: string; range: PortfolioHistoryRange },
) {
  const holdings = await loadHoldings(ctx, args.portfolio_id);
  if (holdings.length === 0) {
    return {
      message:
        "Portfolio history needs holdings with a quantity. This portfolio has none recorded.",
    };
  }

  const history = await buildPortfolioHistory(holdings, args.range);
  const points = history.points;
  const first = points.at(0);
  const last = points.at(-1);

  return {
    range: args.range,
    // The series is rebuilt from *current* holdings, so it is not a trade-by-
    // trade record. Stating that here keeps the model from calling it one.
    caveat: PORTFOLIO_HISTORY_CAVEAT,
    missing_symbols: history.missing_symbols,
    start_value: first?.value ?? null,
    end_value: last?.value ?? null,
    change:
      first && last ? last.value - first.value : null,
    change_pct:
      first && last && first.value > 0
        ? ((last.value - first.value) / first.value) * 100
        : null,
    // Full series would be thousands of tokens for no gain; the model needs the
    // shape, not every tick.
    sample_points: samplePoints(points, 24),
  };
}

/** Evenly-spaced subsample that always keeps the first and last point. */
function samplePoints(points: { time: number; value: number }[], max: number) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: { time: number; value: number }[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/* ---------------------------------------------------- compare portfolios */

export const comparePortfoliosSchema = z.object({
  portfolio_ids: z
    .array(z.string().uuid())
    .min(2)
    .max(4)
    .describe("Two to four portfolio ids, from list_portfolios."),
  range: rangeField,
});

export async function comparePortfolios(
  ctx: McpAuthContext,
  args: { portfolio_ids: string[]; range: PortfolioHistoryRange },
) {
  const supabase = createUserClient(ctx);
  const { data: rows, error } = await supabase
    .from("portfolios")
    .select("id, name")
    .in("id", args.portfolio_ids);
  if (error) throw new Error(`Failed to load portfolios: ${error.message}`);

  const names = new Map(
    (rows ?? []).map((r) => [r.id as string, r.name as string]),
  );

  const series = await Promise.all(
    args.portfolio_ids.map(async (id) => {
      const holdings = await loadHoldings(ctx, id);
      if (holdings.length === 0) {
        return { portfolio_id: id, name: names.get(id) ?? id, message: "No priced holdings." };
      }
      const history = await buildPortfolioHistory(holdings, args.range);
      const first = history.points.at(0);
      const last = history.points.at(-1);
      return {
        portfolio_id: id,
        name: names.get(id) ?? id,
        start_value: first?.value ?? null,
        end_value: last?.value ?? null,
        change_pct:
          first && last && first.value > 0
            ? ((last.value - first.value) / first.value) * 100
            : null,
        missing_symbols: history.missing_symbols,
      };
    }),
  );

  // A benchmark makes "which did better" answerable in absolute terms rather
  // than only relative to each other.
  let benchmark: { symbol: string; change_pct: number | null } | null = null;
  try {
    const spy = await fetchYahooChart("SPY", args.range);
    const f = spy.points.at(0);
    const l = spy.points.at(-1);
    benchmark = {
      symbol: "SPY",
      change_pct: f && l && f.value > 0 ? ((l.value - f.value) / f.value) * 100 : null,
    };
  } catch {
    benchmark = null;
  }

  return { range: args.range, caveat: PORTFOLIO_HISTORY_CAVEAT, portfolios: series, benchmark };
}

/* ------------------------------------------------------------ correlation */

export const getCorrelationSchema = z.object({
  symbols: z
    .array(
      z
        .string()
        .transform((s) => s.trim().toUpperCase())
        .refine((s) => SYMBOL_RE.test(s), "Not a valid ticker symbol"),
    )
    .min(2)
    .max(12)
    .describe("Two to twelve tickers to correlate against each other."),
});

/** Pearson correlation of two equal-length return series. */
export function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const sx = stdDev(xs);
  const sy = stdDev(ys);
  if (sx === 0 || sy === 0) return null;
  const r = covariance(xs, ys) / (sx * sy);
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null;
}

export async function getCorrelation(
  _ctx: McpAuthContext,
  args: { symbols: string[] },
) {
  const symbols = [...new Set(args.symbols)];

  const fetched = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const res = await fetchYahooChart(symbol, "1Y");
        return { symbol, points: res.points as HistoryPoint[] };
      } catch (err) {
        if (err instanceof YahooFetchError) return { symbol, points: null };
        throw err;
      }
    }),
  );

  const usable = fetched.filter(
    (f): f is { symbol: string; points: HistoryPoint[] } =>
      f.points != null && f.points.length > 1,
  );
  const missing = fetched.filter((f) => f.points == null).map((f) => f.symbol);

  if (usable.length < 2) {
    return {
      message: "Need price history for at least two of those tickers.",
      missing_symbols: missing,
    };
  }

  const pairs: { a: string; b: string; correlation: number | null }[] = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      // Align on shared timestamps first: two series with different trading
      // calendars would otherwise be correlated off-by-one against each other.
      const aligned = alignByTime(usable[i].points, usable[j].points);
      pairs.push({
        a: usable[i].symbol,
        b: usable[j].symbol,
        correlation: correlation(
          dailyReturns(aligned.aValues),
          dailyReturns(aligned.bValues),
        ),
      });
    }
  }

  pairs.sort((x, y) => (y.correlation ?? -2) - (x.correlation ?? -2));

  return {
    range: "1Y",
    basis: "daily returns, Pearson",
    missing_symbols: missing.length ? missing : undefined,
    pairs,
  };
}

/* -------------------------------------------------------------- balances */

export const getBalancesSchema = z.object({});

/**
 * Cash and bank balances, converted to USD at the current rate.
 *
 * `as_of` is returned per account and is load-bearing: unlike a price, an
 * uploaded balance never refreshes itself, so an answer that quotes net worth
 * has to be able to say how old the cash half of it is.
 */
export async function getBalances(ctx: McpAuthContext) {
  const supabase = createUserClient(ctx);
  const { data, error } = await supabase
    .from("balances")
    .select("label, amount, currency, as_of")
    .eq("user_id", ctx.userId)
    .order("label", { ascending: true });
  if (error) throw new Error(`Failed to load balances: ${error.message}`);

  const rows = (data ?? []).map((r) => ({
    id: "",
    label: String(r.label),
    amount: Number(r.amount),
    currency: String(r.currency).toUpperCase(),
    asOf: String(r.as_of),
  }));

  if (rows.length === 0) {
    return {
      message:
        "No cash or bank balances have been uploaded. The user can add them from Add → Add balances on the dashboard.",
    };
  }

  const rates = await usdRates(rows.map((r) => r.currency));
  const total = totalUsd(rows, rates);

  return {
    accounts: rows.map((r) => ({
      label: r.label,
      amount: r.amount,
      currency: r.currency,
      usd_value: toUsd(r, rates),
      as_of: r.asOf,
    })),
    total_usd: total.usd,
    unconvertible_currencies: total.missing.length ? total.missing : undefined,
    note: "Balances are uploaded by hand and do not refresh. Check as_of before treating them as current.",
  };
}
