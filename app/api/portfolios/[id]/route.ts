import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import type { Portfolio } from "@/types";

export const runtime = "nodejs";

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

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await requireUser();
  if (authError) return authError;
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
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
  if (!name) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN);

  const { data, error } = await supabase
    .from(TABLE)
    .update({ name })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, position, created_at")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ portfolio: mapRow(data) });
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await requireUser();
  if (authError) return authError;
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { count, error: countErr } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countErr) {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "You need at least one portfolio." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
