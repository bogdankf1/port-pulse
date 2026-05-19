import { NextResponse, type NextRequest } from "next/server";
import type { HistoryRange, HistoryResponse } from "@/types";
import {
  YahooFetchError,
  fetchYahooChart,
  yahooRevalidateSeconds,
} from "@/lib/yahoo";

export const runtime = "nodejs";

const RANGES: ReadonlySet<HistoryRange> = new Set([
  "1D",
  "1M",
  "3M",
  "YTD",
  "1Y",
  "5Y",
]);

function isHistoryRange(v: unknown): v is HistoryRange {
  return typeof v === "string" && RANGES.has(v as HistoryRange);
}

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

  let result;
  try {
    result = await fetchYahooChart(symbol, range, intervalParam);
  } catch (err) {
    if (err instanceof YahooFetchError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  const revalidate = yahooRevalidateSeconds(result.interval);
  const body: HistoryResponse = {
    symbol: result.symbol,
    range: result.range,
    interval: result.interval,
    currency: result.currency,
    points: result.points,
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=${revalidate * 4}`,
    },
  });
}
