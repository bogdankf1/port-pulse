import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ticker } from "@/types";

export const runtime = "nodejs";

const TABLE = "watchlist_items";
const PORTFOLIOS = "portfolios";

function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

async function getAuthedSupabase() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, supabase };
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}

async function ensureOwnedPortfolio(
  supabase: SupabaseClient,
  userId: string,
  portfolioId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(PORTFOLIOS)
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export async function GET(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, supabase } = await getAuthedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const portfolioId = request.nextUrl.searchParams.get("portfolio_id");
  if (!portfolioId) {
    return NextResponse.json(
      { error: "Missing portfolio_id" },
      { status: 400 },
    );
  }
  if (!(await ensureOwnedPortfolio(supabase, user.id, portfolioId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select("symbol, name, quantity, entry_price")
    .eq("user_id", user.id)
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const tickers: Ticker[] = (data || []).map((r) => ({
    symbol: String(r.symbol),
    name: typeof r.name === "string" ? r.name : "",
    quantity: toFiniteNumber(r.quantity),
    entryPrice: toFiniteNumber(r.entry_price),
  }));
  return NextResponse.json({ tickers });
}

export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, supabase } = await getAuthedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const portfolioId = typeof obj?.portfolio_id === "string" ? obj.portfolio_id : null;
  const incoming = Array.isArray(obj?.tickers) ? (obj.tickers as unknown[]) : null;

  if (!portfolioId) {
    return NextResponse.json({ error: "Missing portfolio_id" }, { status: 400 });
  }
  if (!incoming) {
    return NextResponse.json({ error: "Missing tickers" }, { status: 400 });
  }
  if (!(await ensureOwnedPortfolio(supabase, user.id, portfolioId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  type Row = {
    user_id: string;
    portfolio_id: string;
    symbol: string;
    name: string;
    quantity: number | null;
    entry_price: number | null;
  };
  const valid: Row[] = [];
  const seen = new Set<string>();
  for (const item of incoming) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { symbol?: unknown }).symbol === "string"
    ) {
      const symbol = (item as { symbol: string }).symbol.trim().toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol)) continue;
      seen.add(symbol);
      const rawName = (item as { name?: unknown }).name;
      const qty = toFiniteNumber((item as { quantity?: unknown }).quantity);
      const entry = toFiniteNumber(
        (item as { entryPrice?: unknown }).entryPrice,
      );
      valid.push({
        user_id: user.id,
        portfolio_id: portfolioId,
        symbol,
        name: typeof rawName === "string" ? rawName : "",
        quantity: qty ?? null,
        entry_price: entry ?? null,
      });
    }
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, written: 0 });
  }

  const { error } = await supabase
    .from(TABLE)
    .upsert(valid, { onConflict: "portfolio_id,symbol" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, written: valid.length });
}

export async function DELETE(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, supabase } = await getAuthedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const portfolioId = request.nextUrl.searchParams.get("portfolio_id");
  if (!portfolioId) {
    return NextResponse.json(
      { error: "Missing portfolio_id" },
      { status: 400 },
    );
  }
  if (!(await ensureOwnedPortfolio(supabase, user.id, portfolioId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  let query = supabase
    .from(TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("portfolio_id", portfolioId);
  if (symbolsParam) {
    const symbols = symbolsParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (symbols.length === 0) {
      return NextResponse.json({ ok: true });
    }
    query = query.in("symbol", symbols);
  }
  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
