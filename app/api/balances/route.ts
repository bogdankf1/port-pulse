import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { usdRates } from "@/lib/mcp/fx";
import { duplicateKeys, normalizeGroup, totalUsd } from "@/lib/balances";
import type { Balance, ParsedBalance } from "@/types";

export const runtime = "nodejs";

const TABLE = "balances";
const MAX_ROWS = 100;

const COLUMNS = "id, label, amount, currency, group_name, as_of";

type Row = {
  id: string;
  label: string;
  amount: number | string;
  currency: string;
  group_name: string | null;
  as_of: string;
};

function toBalance(r: Row): Balance {
  return {
    id: String(r.id),
    label: String(r.label),
    // Postgres `numeric` arrives as a string through PostgREST; Number() here
    // rather than at every call site that adds it up.
    amount: Number(r.amount),
    currency: String(r.currency).toUpperCase(),
    group: normalizeGroup(r.group_name),
    asOf: String(r.as_of),
  };
}

async function withRates(balances: Balance[]) {
  const rates = await usdRates(balances.map((b) => b.currency));
  const total = totalUsd(balances, rates);
  return {
    balances,
    rates: Object.fromEntries(rates),
    total_usd: total.usd,
    missing_rates: total.missing,
  };
}

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order("group_name", { ascending: true })
    .order("label", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const balances = ((data ?? []) as Row[]).map(toBalance);
  return NextResponse.json(await withRates(balances), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * Apply an upload. The payload REPLACES the stored set — whatever the file says
 * becomes the whole truth, which is how the data stays current without a
 * separate pruning step: an account you close stops appearing in the export and
 * so stops appearing here.
 *
 * The delete and insert happen inside the `replace_balances` function so they
 * are one transaction. Doing them as two calls from here would leave a window
 * where a failure had deleted everything and inserted nothing.
 *
 * The caller shows every removal for confirmation before reaching this point.
 */
export async function PUT(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let body: { rows?: unknown };
  try {
    body = (await request.json()) as { rows?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const list = Array.isArray(body.rows) ? body.rows : null;
  if (!list || list.length === 0) {
    return NextResponse.json({ error: "No rows to save" }, { status: 400 });
  }
  if (list.length > MAX_ROWS) {
    return NextResponse.json({ error: "Too many rows" }, { status: 400 });
  }

  const rows: ParsedBalance[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 80) : "";
    const amount = typeof r.amount === "number" ? r.amount : NaN;
    const currency =
      typeof r.currency === "string" ? r.currency.trim().toUpperCase() : "";
    // A group is optional — a file that names no institution still saves.
    const group =
      typeof r.group === "string" ? normalizeGroup(r.group.slice(0, 60)) : null;
    if (!label || !Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json(
        { error: "Every row needs a name, a numeric amount and a 3-letter currency" },
        { status: 400 },
      );
    }
    rows.push({ label, amount, currency, group });
  }

  // The same group, name AND currency twice cannot all be stored. Caught here so
  // the user reads which account is doubled rather than a Postgres constraint
  // name.
  const dupes = duplicateKeys(rows);
  if (dupes.length > 0) {
    const named = dupes
      .map((d) => `"${d.group ? `${d.group} · ${d.label}` : d.label}" (${d.currency})`)
      .join(", ");
    return NextResponse.json(
      {
        error: `That file lists ${named} more than once. Give each account one row, or a distinct name.`,
      },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc("replace_balances", { rows });
  if (error) {
    // Anything the checks above missed still reaches the user as English, not
    // as a constraint name.
    const message = /duplicate key|unique constraint/i.test(error.message)
      ? "That file lists the same group, account and currency twice. Give each account one row."
      : error.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order("group_name", { ascending: true })
    .order("label", { ascending: true });

  return NextResponse.json(await withRates(((data ?? []) as Row[]).map(toBalance)), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  // No id means clear them all — the "remove balances" path, not an accident:
  // the caller confirms before reaching here.
  const query = supabase.from(TABLE).delete();
  const { error } = id
    ? await query.eq("id", id)
    : await query.eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
