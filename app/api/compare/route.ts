import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";
import {
  BENCHMARKS,
  COMPARE_RANGES,
  isCompareRange,
  type CompareRange,
  type CompareResponse,
  type CompareSeries,
  type ComparePoint,
} from "@/lib/compare";
import type { HistoryPoint } from "@/types";

export const runtime = "nodejs";

const TABLE = "watchlist_items";
const PORTFOLIOS = "portfolios";

const SYMBOL_RE = /^[A-Z]{1,10}(\.[A-Z]{1,3})?$/;

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

type Holding = { portfolioId: string; symbol: string; quantity: number };

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const rangeRaw = params.get("range") || "";
  if (!isCompareRange(rangeRaw)) {
    return NextResponse.json(
      {
        error: `Invalid range. Allowed: ${COMPARE_RANGES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const range: CompareRange = rangeRaw;

  const portfolioIds = parseList(params.get("portfolios"));
  const benchmarkIds = parseList(params.get("benchmarks"));

  if (portfolioIds.length === 0 && benchmarkIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one portfolio or benchmark" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate benchmark IDs against allow-list.
  const validBenchmarks = benchmarkIds
    .map((id) => BENCHMARKS.find((b) => b.id === id))
    .filter((b): b is (typeof BENCHMARKS)[number] => Boolean(b));

  // Validate portfolio ownership + load metadata.
  let portfolioMeta: { id: string; name: string }[] = [];
  if (portfolioIds.length > 0) {
    const { data, error } = await supabase
      .from(PORTFOLIOS)
      .select("id, name")
      .in("id", portfolioIds)
      .eq("user_id", user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    portfolioMeta = (data || []).map((r) => ({
      id: String(r.id),
      name: typeof r.name === "string" ? r.name : "Portfolio",
    }));
  }
  const ownedIds = new Set(portfolioMeta.map((p) => p.id));

  // Load holdings (only rows with a positive quantity).
  const holdings: Holding[] = [];
  if (ownedIds.size > 0) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("portfolio_id, symbol, quantity")
      .eq("user_id", user.id)
      .in("portfolio_id", Array.from(ownedIds))
      .not("quantity", "is", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const row of data || []) {
      const symbol = String(row.symbol || "").trim().toUpperCase();
      const qty = typeof row.quantity === "number" ? row.quantity : NaN;
      if (!symbol || !SYMBOL_RE.test(symbol)) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      holdings.push({
        portfolioId: String(row.portfolio_id),
        symbol,
        quantity: qty,
      });
    }
  }

  // Fetch history for every unique symbol (holdings ∪ benchmarks).
  const allSymbols = new Set<string>(validBenchmarks.map((b) => b.symbol));
  for (const h of holdings) allSymbols.add(h.symbol);

  const historyEntries = await Promise.all(
    Array.from(allSymbols).map(async (sym) => {
      try {
        const res = await fetchYahooChart(sym, range);
        return [sym, res.points] as const;
      } catch (err) {
        if (err instanceof YahooFetchError) {
          return [sym, null, err.message] as const;
        }
        return [sym, null, "Upstream fetch failed"] as const;
      }
    }),
  );

  const historyBySymbol = new Map<string, HistoryPoint[]>();
  const missingSymbols: string[] = [];
  for (const entry of historyEntries) {
    const [sym, points] = entry;
    if (points && points.length > 0) {
      historyBySymbol.set(sym, points);
    } else {
      missingSymbols.push(sym);
    }
  }

  const series: CompareSeries[] = [];

  // Build portfolio series — t0 is the latest start date across that portfolio's symbols.
  for (const meta of portfolioMeta) {
    const portHoldings = holdings.filter((h) => h.portfolioId === meta.id);
    if (portHoldings.length === 0) continue;

    const usable = portHoldings.filter((h) => historyBySymbol.has(h.symbol));
    if (usable.length === 0) continue;

    const symbolHistories = usable.map((h) => ({
      holding: h,
      points: historyBySymbol.get(h.symbol)!,
    }));

    const latestStart = symbolHistories.reduce(
      (acc, s) => Math.max(acc, s.points[0].time),
      0,
    );

    // Build the union of timestamps at-or-after latestStart, then valuate.
    const timeSet = new Set<number>();
    for (const s of symbolHistories) {
      for (const p of s.points) {
        if (p.time >= latestStart) timeSet.add(p.time);
      }
    }
    const times = Array.from(timeSet).sort((a, b) => a - b);
    if (times.length === 0) continue;

    // Pre-compute search arrays per symbol for snap-to-prior-price lookups.
    const seriesValues = computePortfolioValues(times, symbolHistories);
    if (seriesValues.length === 0) continue;
    const startValue = seriesValues[0].value;
    if (!Number.isFinite(startValue) || startValue <= 0) continue;
    const endValue = seriesValues[seriesValues.length - 1].value;

    const points: ComparePoint[] = seriesValues.map((p) => ({
      time: p.time,
      value: p.value,
      pct: (p.value / startValue - 1) * 100,
    }));

    series.push({
      id: `portfolio:${meta.id}`,
      label: meta.name || "Portfolio",
      kind: "portfolio",
      portfolioId: meta.id,
      points,
      startValue,
      endValue,
    });
  }

  // Build benchmark series.
  for (const b of validBenchmarks) {
    const points = historyBySymbol.get(b.symbol);
    if (!points || points.length === 0) continue;
    const startValue = points[0].value;
    if (!Number.isFinite(startValue) || startValue <= 0) continue;
    const endValue = points[points.length - 1].value;
    const cp: ComparePoint[] = points.map((p) => ({
      time: p.time,
      value: p.value,
      pct: (p.value / startValue - 1) * 100,
    }));
    series.push({
      id: `benchmark:${b.id}`,
      label: b.label,
      kind: "benchmark",
      symbol: b.symbol,
      points: cp,
      startValue,
      endValue,
    });
  }

  const startTime = series.reduce<number | null>((acc, s) => {
    const first = s.points[0]?.time;
    if (typeof first !== "number") return acc;
    return acc == null ? first : Math.min(acc, first);
  }, null);

  const caveat = series.some((s) => s.kind === "portfolio")
    ? "Portfolio history reflects your current holdings throughout the period. Past buys and sells aren't accounted for."
    : undefined;

  const body: CompareResponse = {
    range,
    startTime,
    series,
    ...(caveat ? { caveat } : {}),
  };

  const headers: Record<string, string> = {
    "Cache-Control": "private, max-age=0, no-store",
  };
  if (missingSymbols.length > 0) {
    headers["X-Compare-Missing"] = missingSymbols.join(",");
  }
  return NextResponse.json(body, { headers });
}

type HoldingHistory = { holding: Holding; points: HistoryPoint[] };

function computePortfolioValues(
  times: number[],
  symbolHistories: HoldingHistory[],
): { time: number; value: number }[] {
  // For each symbol, walk a pointer through its sorted points to find the
  // most-recent price at-or-before each target time (snap-to-prior).
  const pointers = new Map<string, number>();
  for (const sh of symbolHistories) pointers.set(sh.holding.symbol, 0);

  const out: { time: number; value: number }[] = [];
  for (const t of times) {
    let total = 0;
    let allPriced = true;
    for (const sh of symbolHistories) {
      const sym = sh.holding.symbol;
      const pts = sh.points;
      let i = pointers.get(sym) ?? 0;
      while (i + 1 < pts.length && pts[i + 1].time <= t) i++;
      pointers.set(sym, i);
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
