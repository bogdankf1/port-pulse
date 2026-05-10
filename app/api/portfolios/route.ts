import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Portfolio } from "@/types";

export const runtime = "nodejs";

const TABLE = "portfolios";
const MAX_NAME_LEN = 60;

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

function mapRow(r: {
  id: string;
  name: string;
  position: number;
  created_at: string;
}): Portfolio {
  return {
    id: r.id,
    name: r.name,
    position: r.position,
    createdAt: r.created_at,
  };
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
    .select("id, name, position, created_at")
    .eq("user_id", user.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = data || [];

  // Auto-create the first portfolio if none exist so the client has a target.
  if (rows.length === 0) {
    const { data: created, error: insErr } = await supabase
      .from(TABLE)
      .insert({ user_id: user.id, name: "Portfolio 1", position: 0 })
      .select("id, name, position, created_at")
      .single();
    if (insErr || !created) {
      return NextResponse.json(
        { error: insErr?.message || "Failed to create default portfolio" },
        { status: 500 },
      );
    }
    rows = [created];
  }

  return NextResponse.json({ portfolios: rows.map(mapRow) });
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

  const rawName =
    body && typeof body === "object"
      ? (body as { name?: unknown }).name
      : undefined;
  let name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN);

  // Find next position; if no name, default to "Portfolio N".
  const { data: existing, error: listErr } = await supabase
    .from(TABLE)
    .select("position, name")
    .eq("user_id", user.id);
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const nextPosition =
    (existing || []).reduce((m, r) => Math.max(m, r.position), -1) + 1;
  if (!name) name = `Portfolio ${(existing?.length || 0) + 1}`;

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ user_id: user.id, name, position: nextPosition })
    .select("id, name, position, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Insert failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ portfolio: mapRow(data) });
}
