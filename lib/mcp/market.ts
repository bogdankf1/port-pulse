import "server-only";
import { z } from "zod";
import { SYMBOL_RE } from "./config";

/**
 * Market-reference tools backed by Finnhub, whose token the app already holds
 * for the price websocket. All read-only.
 *
 * These exist alongside web search on purpose: search returns prose that has to
 * be trusted and parsed, while these return the same structured numbers every
 * time. When the assistant needs a figure it will state, it should come from
 * here; search is for context that has no API.
 */

const FINNHUB = "https://finnhub.io/api/v1";

function token(): string {
  const t = process.env.NEXT_PUBLIC_FINNHUB_TOKEN;
  if (!t) throw new Error("Market data is not configured (missing Finnhub token).");
  return t;
}

async function finnhub<T>(path: string, revalidate: number): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FINNHUB}/${path}${sep}token=${encodeURIComponent(token())}`;
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate } });
  } catch {
    throw new Error("Market data provider unreachable");
  }
  if (res.status === 429) {
    throw new Error("Market data temporarily rate-limited. Try again shortly.");
  }
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("Market data response was not readable");
  }
}

const symbolField = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => SYMBOL_RE.test(s), "Not a valid ticker symbol");

/* ------------------------------------------------------------------ search */

export const searchSymbolSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(60)
    .describe("Company name or partial ticker, e.g. \"nvidia\" or \"palan\"."),
});

type FinnhubSearch = {
  result?: { symbol?: string; displaySymbol?: string; description?: string; type?: string }[];
};

export async function searchSymbol(args: { query: string }) {
  const json = await finnhub<FinnhubSearch>(
    `search?q=${encodeURIComponent(args.query.trim())}`,
    3600,
  );
  const results = (json.result ?? [])
    // Finnhub returns every foreign listing of the same company; the plain
    // symbols are the ones this app can actually price and chart.
    .filter((r) => r?.symbol && SYMBOL_RE.test(r.symbol.toUpperCase()))
    .slice(0, 8)
    .map((r) => ({
      symbol: (r.symbol as string).toUpperCase(),
      name: r.description ?? "",
      type: r.type ?? "",
    }));

  if (results.length === 0) {
    return { message: `No tradable symbol matched "${args.query}".` };
  }
  return { query: args.query, results };
}

/* ------------------------------------------------------------ fundamentals */

export const getCompanyFundamentalsSchema = z.object({ symbol: symbolField });

type FinnhubMetric = { metric?: Record<string, number | string | null> };

export async function getCompanyFundamentals(args: { symbol: string }) {
  const json = await finnhub<FinnhubMetric>(
    `stock/metric?symbol=${encodeURIComponent(args.symbol)}&metric=all`,
    3600,
  );
  const m = json.metric ?? {};
  const num = (k: string): number | null => {
    const v = m[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const out = {
    symbol: args.symbol,
    pe_ttm: num("peTTM"),
    eps_ttm: num("epsTTM"),
    // Finnhub reports market cap in millions of USD.
    market_cap_usd: num("marketCapitalization") != null ? num("marketCapitalization")! * 1e6 : null,
    beta: num("beta"),
    week_52_high: num("52WeekHigh"),
    week_52_low: num("52WeekLow"),
    week_52_return_pct: num("52WeekPriceReturnDaily"),
    dividend_yield_pct: num("dividendYieldIndicatedAnnual"),
    revenue_growth_ttm_yoy_pct: num("revenueGrowthTTMYoy"),
    roe_ttm_pct: num("roeTTM"),
  };

  if (Object.values(out).every((v) => v === null || v === args.symbol)) {
    return { message: `No fundamentals published for ${args.symbol}.` };
  }
  return out;
}

/* --------------------------------------------------------------- earnings */

export const getEarningsCalendarSchema = z.object({
  symbols: z
    .array(symbolField)
    .min(1)
    .max(30)
    .describe("Tickers to check, normally the user's holdings."),
  days_ahead: z
    .number()
    .int()
    .min(1)
    .max(180)
    .optional()
    .describe("How far forward to look. Defaults to 30 days."),
});

type FinnhubEarnings = {
  earningsCalendar?: {
    symbol?: string;
    date?: string;
    hour?: string;
    quarter?: number;
    year?: number;
    epsEstimate?: number | null;
  }[];
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getEarningsCalendar(args: {
  symbols: string[];
  days_ahead?: number;
}) {
  const days = args.days_ahead ?? 30;
  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);

  // One request per symbol: the unfiltered range endpoint returns the entire
  // market for the window, which is megabytes and mostly irrelevant.
  const settled = await Promise.allSettled(
    [...new Set(args.symbols)].map(async (symbol) => {
      const json = await finnhub<FinnhubEarnings>(
        `calendar/earnings?from=${isoDay(from)}&to=${isoDay(to)}&symbol=${encodeURIComponent(symbol)}`,
        3600,
      );
      return (json.earningsCalendar ?? [])
        .filter((e) => e?.date)
        .map((e) => ({
          symbol,
          date: e.date as string,
          hour: e.hour || null,
          quarter: e.quarter ?? null,
          year: e.year ?? null,
          eps_estimate: e.epsEstimate ?? null,
        }));
    }),
  );

  const events = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (events.length === 0) {
    return {
      message: `No earnings scheduled for those tickers in the next ${days} days.`,
      window: { from: isoDay(from), to: isoDay(to) },
    };
  }
  return { window: { from: isoDay(from), to: isoDay(to) }, events };
}

/* --------------------------------------------------------- market context */

/** Index and volatility gauges, so an answer can say whether a move is the
 *  portfolio's or the market's. `^` symbols are Finnhub index tickers. */
const CONTEXT_SYMBOLS: readonly { symbol: string; label: string }[] = [
  { symbol: "SPY", label: "S&P 500 ETF" },
  { symbol: "QQQ", label: "Nasdaq 100 ETF" },
  { symbol: "DIA", label: "Dow Jones ETF" },
];

export const getMarketContextSchema = z.object({});

type FinnhubQuote = { c?: number; d?: number; dp?: number; pc?: number; t?: number };

export async function getMarketContext() {
  const settled = await Promise.allSettled(
    CONTEXT_SYMBOLS.map(async ({ symbol, label }) => {
      const q = await finnhub<FinnhubQuote>(
        `quote?symbol=${encodeURIComponent(symbol)}`,
        300,
      );
      if (typeof q.c !== "number" || q.c <= 0) throw new Error("no quote");
      return {
        symbol,
        label,
        price: q.c,
        change: q.d ?? null,
        change_pct: q.dp ?? null,
        previous_close: q.pc ?? null,
      };
    }),
  );

  const indices = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (indices.length === 0) {
    return { message: "Market context is unavailable right now." };
  }
  return { as_of: new Date().toISOString(), indices };
}
