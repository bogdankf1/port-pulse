import type { Ticker } from "@/types";

/** A symbol's live price and its previous session close. Either may be unknown. */
export type Quote = { price: number | null; prevClose: number | null };
export type Quotes = ReadonlyMap<string, Quote>;

const EMPTY_QUOTE: Quote = { price: null, prevClose: null };

export function quoteFor(quotes: Quotes, symbol: string): Quote {
  return quotes.get(symbol) ?? EMPTY_QUOTE;
}

export type SortColumn =
  | "ticker"
  | "name"
  | "qty"
  | "entry"
  | "current"
  | "value"
  | "pl"
  | "percent"
  | "day";
export type SortDir = "asc" | "desc";
export type SortState = { column: SortColumn; direction: SortDir };

const NUMERIC: ReadonlySet<SortColumn> = new Set([
  "qty",
  "entry",
  "current",
  "value",
  "pl",
  "percent",
  "day",
]);

export function defaultDir(col: SortColumn): SortDir {
  return NUMERIC.has(col) ? "desc" : "asc";
}

export type SortContext = {
  quotes: Quotes;
  totalValue: number;
  /** Falls back to a profile-derived name when the ticker carries none. */
  nameFor?: (symbol: string) => string | undefined;
};

export function marketValue(t: Ticker, quotes: Quotes): number | null {
  const { price } = quoteFor(quotes, t.symbol);
  if (price == null || t.quantity == null) return null;
  return price * t.quantity;
}

export function costBasis(t: Ticker): number | null {
  if (t.entryPrice == null || t.quantity == null) return null;
  return t.entryPrice * t.quantity;
}

export function unrealizedPl(t: Ticker, quotes: Quotes): number | null {
  const value = marketValue(t, quotes);
  const cost = costBasis(t);
  if (value == null || cost == null) return null;
  return value - cost;
}

/** Today's move in dollars. Needs price, prev close and quantity. */
export function dayChange(t: Ticker, quotes: Quotes): number | null {
  const { price, prevClose } = quoteFor(quotes, t.symbol);
  if (price == null || prevClose == null || prevClose <= 0) return null;
  if (t.quantity == null) return null;
  return (price - prevClose) * t.quantity;
}

/** Today's move as a percent of prev close. Independent of quantity. */
export function dayChangePct(t: Ticker, quotes: Quotes): number | null {
  const { price, prevClose } = quoteFor(quotes, t.symbol);
  if (price == null || prevClose == null || prevClose <= 0) return null;
  return ((price - prevClose) / prevClose) * 100;
}

export function weightPct(
  t: Ticker,
  quotes: Quotes,
  totalValue: number,
): number | null {
  const value = marketValue(t, quotes);
  if (value == null || totalValue <= 0) return null;
  return (value / totalValue) * 100;
}

export type Totals = {
  /** Every priced holding. */
  marketValue: number;
  /** Only holdings that have BOTH a live price and an entry price. */
  costBasis: number;
  /** Over the same subset as `costBasis` — this is NOT `marketValue - costBasis`. */
  pl: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  hasAnyValue: boolean;
};

/** The holding's market value at the previous close — the denominator for day-change %. */
function prevCloseValue(t: Ticker, quotes: Quotes): number | null {
  const { prevClose } = quoteFor(quotes, t.symbol);
  if (prevClose == null || prevClose <= 0 || t.quantity == null) return null;
  return prevClose * t.quantity;
}

export function computeTotals(tickers: readonly Ticker[], quotes: Quotes): Totals {
  let totalValue = 0;
  let basis = 0;
  // Market value of only those holdings that also have a cost basis, so that
  // P&L is a like-for-like difference. Summing full market value against a
  // partial cost basis inflates P&L.
  let pricedWithBasis = 0;
  let day = 0;
  let dayBase = 0;
  let hasAnyValue = false;
  let hasAnyBasis = false;
  let hasAnyDay = false;

  for (const t of tickers) {
    const value = marketValue(t, quotes);
    if (value != null) {
      totalValue += value;
      hasAnyValue = true;
    }
    const cost = costBasis(t);
    if (value != null && cost != null) {
      basis += cost;
      pricedWithBasis += value;
      hasAnyBasis = true;
    }
    const d = dayChange(t, quotes);
    const base = prevCloseValue(t, quotes);
    if (d != null && base != null) {
      day += d;
      dayBase += base;
      hasAnyDay = true;
    }
  }

  return {
    marketValue: totalValue,
    costBasis: basis,
    pl: hasAnyBasis ? pricedWithBasis - basis : null,
    dayChange: hasAnyDay ? day : null,
    dayChangePct: hasAnyDay && dayBase > 0 ? (day / dayBase) * 100 : null,
    hasAnyValue,
  };
}

export function sortValue(
  t: Ticker,
  col: SortColumn,
  ctx: SortContext,
): string | number | null {
  switch (col) {
    case "ticker":
      return t.symbol;
    case "name": {
      const n = t.name || ctx.nameFor?.(t.symbol) || "";
      return n || null;
    }
    case "qty":
      return t.quantity ?? null;
    case "entry":
      return t.entryPrice ?? null;
    case "current":
      return quoteFor(ctx.quotes, t.symbol).price;
    case "value":
      return marketValue(t, ctx.quotes);
    case "pl":
      return unrealizedPl(t, ctx.quotes);
    case "percent":
      return weightPct(t, ctx.quotes, ctx.totalValue);
    case "day":
      return dayChangePct(t, ctx.quotes);
  }
}

export function sortTickers(
  tickers: readonly Ticker[],
  sort: SortState | null,
  ctx: SortContext,
): readonly Ticker[] {
  if (!sort) return tickers;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...tickers].sort((a, b) => {
    const va = sortValue(a, sort.column, ctx);
    const vb = sortValue(b, sort.column, ctx);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" && typeof vb === "string") {
      return va.localeCompare(vb) * dir;
    }
    return ((va as number) - (vb as number)) * dir;
  });
}
