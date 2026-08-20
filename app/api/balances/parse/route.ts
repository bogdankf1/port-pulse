import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabase } from "@/lib/supabase-server";
import { parseCsv, toPreviewText } from "@/lib/csv";
import type { ParsedBalance } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-opus-5";
const MAX_BYTES = 512 * 1024;
const MAX_ROWS = 200;

const client = new Anthropic();

/**
 * The schema the model must fill. `minItems` above 1 is rejected outright by the
 * API ("for 'array' type, 'minItems' values other than 0 or 1 are not
 * supported"), so emptiness is handled below rather than by the schema.
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "amount", "currency", "group"],
        properties: {
          label: { type: "string", maxLength: 80 },
          amount: { type: "number" },
          currency: { type: "string", minLength: 3, maxLength: 3 },
          // Required-but-nullable rather than optional: a model allowed to omit
          // the key omits it inconsistently, which reads as "no bank" for half
          // the rows in a file that names one for every row.
          group: { type: ["string", "null"], maxLength: 60 },
        },
      },
    },
  },
} as const;

const SYSTEM = [
  "You read a spreadsheet export of someone's cash and bank account balances",
  "and return one row per account.",
  "",
  "The file has no fixed layout. Column names vary, may be in any language, and",
  "there may be preamble or total rows above or below the data. Work out which",
  "columns hold the account name, the amount, the currency and the bank the",
  "account is held at.",
  "",
  "label: the account's name as written, e.g. \"USD card\" or \"Deposit\".",
  "amount: the balance as a number. Strip currency symbols, spaces and",
  "thousands separators. A comma may be a decimal separator — \"1234,56\" is",
  "1234.56, not 123456. Amount and currency are sometimes in one cell",
  "(\"8753 EUR\"); split them.",
  "currency: the 3-letter ISO code, upper case. Map symbols (₴ UAH, € EUR,",
  "$ USD, £ GBP) and words (hryvnia UAH, dollars USD).",
  "group: the bank or institution the account is held at, e.g. \"Monobank\",",
  "\"Privatbank\" or \"Cash\" for money held outside a bank. It is often a",
  "column headed something other than \"bank\" — \"type\", \"institution\",",
  "\"provider\", \"where\" — or it may be a heading row that several accounts",
  "sit under. Use null when the file genuinely says nothing about where an",
  "account is held; do not invent one from the account name.",
  "",
  "Skip header rows, blank rows, and any row that totals the others rather than",
  "being an account. If a row has no readable amount, omit it rather than",
  "guessing a number. Return an empty list if the file holds no balances.",
].join("\n");

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let text: string;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "That file is larger than 512 KB — is it really a balance export?" },
        { status: 400 },
      );
    }
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "Could not read that file" }, { status: 400 });
  }

  const rows = parseCsv(text);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "That file has no rows in it." },
      { status: 400 },
    );
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      {
        error: `That file has ${rows.length} rows. This is for account balances, not a transaction history.`,
      },
      { status: 400 },
    );
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: SYSTEM,
      // The sheet goes over as text rather than being matched against a fixed
      // header list — that is what lets an export in any language or column
      // order work without a parser per bank.
      messages: [{ role: "user", content: toPreviewText(rows, MAX_ROWS) }],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json({ error: "Could not read that file" }, { status: 422 });
    }

    const parsed = JSON.parse(block.text) as { rows?: unknown };
    const list = Array.isArray(parsed.rows) ? parsed.rows : [];

    // Validate here rather than trusting the schema alone: the model still
    // chooses the values, and a NaN amount would land in the total as garbage.
    const balances: ParsedBalance[] = [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const label = typeof r.label === "string" ? r.label.trim() : "";
      const amount = typeof r.amount === "number" ? r.amount : NaN;
      const currency =
        typeof r.currency === "string" ? r.currency.trim().toUpperCase() : "";
      const group = typeof r.group === "string" ? r.group.trim().slice(0, 60) : "";
      if (!label || !Number.isFinite(amount) || !/^[A-Z]{3}$/.test(currency)) {
        continue;
      }
      balances.push({
        label: label.slice(0, 80),
        amount,
        currency,
        group: group || null,
      });
    }

    if (balances.length === 0) {
      return NextResponse.json(
        {
          error:
            "No account balances found in that file. It should have a name, an amount and a currency per row.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      { rows: balances },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that file" },
      { status: 502 },
    );
  }
}
