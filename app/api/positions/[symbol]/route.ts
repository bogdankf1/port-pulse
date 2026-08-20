import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { positionTotals } from "@/lib/holdings";
import type { PositionDetails, PositionPortfolioRow } from "@/types";

export const runtime = "nodejs";

/** Per-user data: never store it in a shared or on-disk cache. */
const PRIVATE = { "Cache-Control": "private, no-store" };

const WATCHLIST = "watchlist_items";
const PORTFOLIOS = "portfolios";

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

type Ctx = { params: Promise<{ symbol: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { symbol: symbolRaw } = await ctx.params;
  const symbol = (symbolRaw || "").trim().toUpperCase();
  if (!symbol || !/^[A-Z]{1,10}(\.[A-Z]{1,3})?$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const { user, supabase, error: authError } = await requireUser();
  if (authError) return authError;

  const { data, error } = await supabase
    .from(WATCHLIST)
    .select("portfolio_id, symbol, name, quantity, entry_price")
    .eq("user_id", user.id)
    .eq("symbol", symbol);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const portfolioIds = Array.from(
    new Set(rows.map((r) => String(r.portfolio_id))),
  );

  const { data: portfolioRows, error: pErr } = await supabase
    .from(PORTFOLIOS)
    .select("id, name, position, created_at")
    .eq("user_id", user.id)
    .in("id", portfolioIds);
  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  const namesById = new Map<string, { name: string; position: number; createdAt: string }>();
  for (const p of portfolioRows || []) {
    namesById.set(String(p.id), {
      name: String(p.name || ""),
      position: typeof p.position === "number" ? p.position : 0,
      createdAt: String(p.created_at || ""),
    });
  }

  const portfolios: PositionPortfolioRow[] = rows.map((r) => {
    const id = String(r.portfolio_id);
    const meta = namesById.get(id);
    return {
      id,
      name: meta?.name || "Untitled",
      quantity: toFiniteNumber(r.quantity),
      entryPrice: toFiniteNumber(r.entry_price),
    };
  });

  portfolios.sort((a, b) => {
    const ma = namesById.get(a.id);
    const mb = namesById.get(b.id);
    const pa = ma?.position ?? 0;
    const pb = mb?.position ?? 0;
    if (pa !== pb) return pa - pb;
    return (ma?.createdAt || "").localeCompare(mb?.createdAt || "");
  });

  // Shared with components/position/PositionHoldings.tsx, which renders these
  // same figures — two implementations of the partial-cost rule is how the page
  // and this route came to disagree about the same holding.
  const totals = positionTotals(portfolios, null);

  const name =
    rows.find((r) => typeof r.name === "string" && r.name)?.name?.toString() ||
    "";

  const body: PositionDetails = {
    symbol,
    name,
    totals: {
      quantity: totals.quantity,
      costBasis: totals.costBasis,
    },
    portfolios,
  };

  return NextResponse.json(body, { headers: PRIVATE });
}
