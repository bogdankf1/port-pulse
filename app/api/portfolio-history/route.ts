import { NextResponse } from "next/server";
import {
  buildPortfolioHistory,
  isPortfolioHistoryRange,
  PORTFOLIO_HISTORY_RANGES,
  sanitizeHoldings,
} from "@/lib/portfolioHistory";

export const runtime = "nodejs";

type RequestBody = { tickers?: unknown; range?: unknown };

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isPortfolioHistoryRange(body.range)) {
    return NextResponse.json(
      { error: `Invalid range. Allowed: ${PORTFOLIO_HISTORY_RANGES.join(", ")}` },
      { status: 400 },
    );
  }

  const holdings = sanitizeHoldings(body.tickers);
  if (holdings.length === 0) {
    return NextResponse.json(
      { error: "No holdings with quantity to chart" },
      { status: 400 },
    );
  }

  try {
    const result = await buildPortfolioHistory(holdings, body.range);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=0, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to build portfolio history" },
      { status: 502 },
    );
  }
}
