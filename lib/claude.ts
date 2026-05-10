import Anthropic from "@anthropic-ai/sdk";
import type { Ticker } from "@/types";

const SYSTEM_PROMPT = `You are parsing a portfolio screenshot from a brokerage app (Robinhood, Interactive Brokers, eToro, etc.).
For every US stock ticker visible in the image, extract:
- symbol: 1-5 uppercase letters (skip crypto, forex, non-US ETFs)
- name: full company name as shown
- quantity: number of shares the user holds, if visible. Look for labels like "Shares", "Qty", "Units", "Position".
- entryPrice: average cost per share, if visible. Look for labels like "Avg Cost", "Average Price", "Cost Basis", "Entry", "Buy Price". This is NOT the current price, NOT the market value, NOT today's change.

Rules:
- Return ONLY a JSON array of objects, no explanation, no markdown fences.
- Format: [{"symbol":"AAPL","name":"Apple Inc.","quantity":10,"entryPrice":150.25}, ...]
- Omit "quantity" entirely if you cannot read it. Same for "entryPrice".
- Numbers must be plain numbers (no $ signs, no commas, no thousands separators).
- If a ticker appears multiple times in one screenshot, return it once with summed quantity and weighted-average entry price.
- If you cannot identify a ticker with confidence, skip it entirely.`;

const MODEL = "claude-opus-4-7";

type SupportedMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function parseScreenshot(
  imageBase64: string,
  mimeType: string,
): Promise<Ticker[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as SupportedMimeType,
              data: imageBase64,
            },
          },
          { type: "text", text: SYSTEM_PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Claude returned malformed JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Claude response was not a JSON array");
  }

  const seen = new Set<string>();
  const tickers: Ticker[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      "symbol" in item &&
      typeof (item as { symbol: unknown }).symbol === "string"
    ) {
      const symbol = (item as { symbol: string }).symbol.trim().toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol)) continue;
      seen.add(symbol);
      const rawName = (item as { name?: unknown }).name;
      const rawQty = (item as { quantity?: unknown }).quantity;
      const rawEntry = (item as { entryPrice?: unknown }).entryPrice;
      tickers.push({
        symbol,
        name: typeof rawName === "string" ? rawName.trim() : "",
        quantity: toFiniteNumber(rawQty),
        entryPrice: toFiniteNumber(rawEntry),
      });
    }
  }

  return tickers;
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
