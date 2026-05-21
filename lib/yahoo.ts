import type { HistoryPoint, HistoryRange } from "@/types";

const USER_AGENT = "Mozilla/5.0";

const ALLOWED_INTERVALS: ReadonlySet<string> = new Set([
  "5m",
  "15m",
  "30m",
  "1h",
  "1d",
  "1wk",
  "1mo",
]);

const RANGE_MAP: Record<HistoryRange, { yahooRange: string; interval: string }> = {
  "1D": { yahooRange: "1d", interval: "5m" },
  "1M": { yahooRange: "1mo", interval: "1d" },
  "3M": { yahooRange: "3mo", interval: "1d" },
  YTD: { yahooRange: "ytd", interval: "1d" },
  "1Y": { yahooRange: "1y", interval: "1d" },
  "5Y": { yahooRange: "5y", interval: "1wk" },
};

type YahooMeta = { currency?: string; symbol?: string };

type YahooResult = {
  meta?: YahooMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{ close?: Array<number | null> }>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
};

type YahooChart = {
  chart?: {
    result?: YahooResult[];
    error?: { description?: string; code?: string } | null;
  };
};

export type YahooFetchResult = {
  symbol: string;
  range: HistoryRange;
  interval: string;
  currency: string;
  points: HistoryPoint[];
};

export class YahooFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YahooFetchError";
    this.status = status;
  }
}

export function resolveInterval(range: HistoryRange, override?: string | null): string {
  if (override && ALLOWED_INTERVALS.has(override)) return override;
  return RANGE_MAP[range].interval;
}

/**
 * Translate an internal ticker symbol to the form Yahoo expects.
 * Yahoo uses a dash for share-class separators (BRK-B, BF-B), while the
 * rest of the app — and most other vendors — uses a dot (BRK.B, BF.B).
 */
export function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

export async function fetchYahooChart(
  symbol: string,
  range: HistoryRange,
  intervalOverride?: string | null,
): Promise<YahooFetchResult> {
  const mapped = RANGE_MAP[range];
  const interval = resolveInterval(range, intervalOverride);
  const yahooSymbol = toYahooSymbol(symbol);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?range=${encodeURIComponent(mapped.yahooRange)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;
  const revalidate = interval === "5m" || interval === "15m" ? 60 : 3600;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate },
    });
  } catch {
    throw new YahooFetchError("Upstream fetch failed", 502);
  }

  if (!res.ok) {
    const msg =
      res.status === 429
        ? "Price history temporarily rate-limited by Yahoo. Try again shortly."
        : res.status === 404
          ? "Symbol not found"
          : `Upstream ${res.status}`;
    throw new YahooFetchError(msg, 502);
  }

  let json: YahooChart;
  try {
    json = (await res.json()) as YahooChart;
  } catch {
    throw new YahooFetchError("Upstream parse failed", 502);
  }

  const result = json.chart?.result?.[0];
  const errMsg = json.chart?.error?.description;
  if (!result || errMsg) {
    throw new YahooFetchError(errMsg || "No data", 404);
  }

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes =
    result.indicators?.quote?.[0]?.close ??
    result.indicators?.adjclose?.[0]?.adjclose ??
    [];

  const points: HistoryPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const c = closes[i];
    if (typeof t === "number" && typeof c === "number" && Number.isFinite(c)) {
      points.push({ time: t, value: c });
    }
  }

  if (points.length === 0) {
    throw new YahooFetchError("No data", 404);
  }

  return {
    symbol,
    range,
    interval,
    currency: result.meta?.currency || "USD",
    points,
  };
}

export function yahooRevalidateSeconds(interval: string): number {
  return interval === "5m" || interval === "15m" ? 60 : 3600;
}
