import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import type { Portfolio } from "@/types";

export const runtime = "nodejs";

/** Per-user data: never store it in a shared or on-disk cache. */
const PRIVATE = { "Cache-Control": "private, no-store" };

const TABLE = "portfolios";
const MAX_NAME_LEN = 60;

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
  const { user, supabase, error: authError } = await requireUser();
  if (authError) return authError;

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

  return NextResponse.json(
    { portfolios: rows.map(mapRow) },
    { headers: PRIVATE },
  );
}

export async function POST(request: NextRequest) {
  const { user, supabase, error: authError } = await requireUser();
  if (authError) return authError;

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
