import { NextResponse, type NextRequest } from "next/server";
import type { HistoryPoint, HistoryRange, HistoryResponse } from "@/types";

export const runtime = "nodejs";

const RANGES: ReadonlySet<HistoryRange> = new Set([
  "1D",
  "1M",
  "3M",
  "YTD",
  "1Y",
  "5Y",
]);

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

const USER_AGENT = "Mozilla/5.0";

function isHistoryRange(v: unknown): v is HistoryRange {
  return typeof v === "string" && RANGES.has(v as HistoryRange);
}

type YahooMeta = {
  currency?: string;
  symbol?: string;
};

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

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbolRaw = params.get("symbol") || "";
  const rangeRaw = params.get("range") || "";
  const intervalParam = params.get("interval");

  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol || !/^[A-Z]{1,10}(\.[A-Z]{1,3})?$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  if (!isHistoryRange(rangeRaw)) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }
  const range: HistoryRange = rangeRaw;

  const mapped = RANGE_MAP[range];
  const interval =
    intervalParam && ALLOWED_INTERVALS.has(intervalParam)
      ? intervalParam
      : mapped.interval;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(mapped.yahooRange)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;

  const revalidate = interval === "5m" || interval === "15m" ? 60 : 3600;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      next: { revalidate },
    });
  } catch {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  if (!res.ok) {
    const msg =
      res.status === 429
        ? "Price history temporarily rate-limited by Yahoo. Try again shortly."
        : res.status === 404
          ? "Symbol not found"
          : `Upstream ${res.status}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  let json: YahooChart;
  try {
    json = (await res.json()) as YahooChart;
  } catch {
    return NextResponse.json({ error: "Upstream parse failed" }, { status: 502 });
  }

  const result = json.chart?.result?.[0];
  const errMsg = json.chart?.error?.description;
  if (!result || errMsg) {
    return NextResponse.json(
      { error: errMsg || "No data" },
      { status: 404 },
    );
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
    return NextResponse.json({ error: "No data" }, { status: 404 });
  }

  const body: HistoryResponse = {
    symbol,
    range,
    interval,
    currency: result.meta?.currency || "USD",
    points,
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=${revalidate * 4}`,
    },
  });
}
