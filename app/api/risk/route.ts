import { NextResponse } from "next/server";
import {
  computePortfolioRisk,
  RiskDataUnavailableError,
  type RiskHolding,
} from "@/lib/mcp/risk";

export const runtime = "nodejs";

const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const MAX_TICKERS = 60;

type RequestBody = {
  tickers?: unknown;
};

function sanitizeHoldings(raw: unknown): RiskHolding[] {
  if (!Array.isArray(raw)) return [];
  const out: RiskHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const symbol =
      typeof obj.symbol === "string"
        ? obj.symbol.trim().toUpperCase()
        : null;
    if (!symbol || !SYMBOL_RE.test(symbol)) continue;
    const qty = typeof obj.quantity === "number" ? obj.quantity : null;
    if (qty == null || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ symbol, quantity: qty });
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const holdings = sanitizeHoldings(body.tickers);
  if (holdings.length === 0) {
    return NextResponse.json(
      { error: "No holdings with quantity to analyze" },
      { status: 400 },
    );
  }

  // The metric computation itself lives in lib/mcp/risk.ts so this route and
  // the get_risk_metrics MCP tool cannot drift apart.
  try {
    const response = await computePortfolioRisk(holdings);
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof RiskDataUnavailableError) {
      return NextResponse.json(
        { error: err.message, missing_symbols: err.missingSymbols },
        { status: 502 },
      );
    }
    throw err;
  }
}
