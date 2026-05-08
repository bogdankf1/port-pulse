import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Ticker } from "@/types";

export const runtime = "nodejs";

const TABLE = "watchlist_items";

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

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, supabase } = await getAuthedSupabase();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select("symbol, name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const tickers: Ticker[] = (data || []).map((r) => ({
    symbol: String(r.symbol),
    name: typeof r.name === "string" ? r.name : "",
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
  const incoming =
    body && typeof body === "object" && Array.isArray((body as { tickers?: unknown }).tickers)
      ? ((body as { tickers: unknown[] }).tickers)
      : null;
  if (!incoming) {
    return NextResponse.json({ error: "Missing tickers" }, { status: 400 });
  }

  const valid: Array<{ user_id: string; symbol: string; name: string }> = [];
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
      valid.push({
        user_id: user.id,
        symbol,
        name: typeof rawName === "string" ? rawName : "",
      });
    }
  }

  if (valid.length === 0) {
    return NextResponse.json({ ok: true, written: 0 });
  }

  const { error } = await supabase
    .from(TABLE)
    .upsert(valid, { onConflict: "user_id,symbol", ignoreDuplicates: true });
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
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  let query = supabase.from(TABLE).delete().eq("user_id", user.id);
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
