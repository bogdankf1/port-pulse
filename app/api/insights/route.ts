import { NextResponse } from "next/server";
import { streamInsights, type InsightsHolding } from "@/lib/insights";

const MAX_HOLDINGS = 60;
const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

type RequestBody = {
  portfolioName?: unknown;
  portfolioId?: unknown;
  tickers?: unknown;
};

function sanitizeHoldings(raw: unknown): InsightsHolding[] {
  if (!Array.isArray(raw)) return [];
  const out: InsightsHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const symbol =
      typeof obj.symbol === "string"
        ? obj.symbol.trim().toUpperCase()
        : null;
    if (!symbol || !SYMBOL_RE.test(symbol)) continue;
    const quantity = typeof obj.quantity === "number" ? obj.quantity : null;
    const currentPrice =
      typeof obj.currentPrice === "number" ? obj.currentPrice : null;
    if (quantity == null || quantity <= 0) continue;
    if (currentPrice == null || currentPrice <= 0) continue;
    const entryPrice =
      typeof obj.entryPrice === "number" && obj.entryPrice > 0
        ? obj.entryPrice
        : null;
    const name =
      typeof obj.name === "string" ? obj.name.slice(0, 80) : undefined;
    out.push({ symbol, name, quantity, entryPrice, currentPrice });
    if (out.length >= MAX_HOLDINGS) break;
  }
  return out;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const portfolioName =
    typeof body.portfolioName === "string" && body.portfolioName.trim()
      ? body.portfolioName.trim().slice(0, 80)
      : "Portfolio";
  const holdings = sanitizeHoldings(body.tickers);

  if (holdings.length === 0) {
    return NextResponse.json(
      { error: "No holdings with quantity and price to analyze" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamInsights({ portfolioName, holdings })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Insights failed";
        // Emit the error inline so the client can show it without a separate
        // out-of-band signal. Client treats `[[ERROR]] <message>` as a failure.
        controller.enqueue(encoder.encode(`\n[[ERROR]] ${message}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
