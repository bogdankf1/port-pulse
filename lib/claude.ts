import Anthropic from "@anthropic-ai/sdk";
import type { Ticker } from "@/types";

const SYSTEM_PROMPT = `You are parsing a portfolio screenshot from a brokerage app (Robinhood, Interactive Brokers, eToro, etc.).
Extract every US stock ticker symbol visible in the image. Skip cryptocurrencies, forex pairs, mutual funds, and ETFs that are not on US exchanges.
Return ONLY a JSON array of objects, no explanation, no markdown fences.
Format: [{ "symbol": "AAPL", "name": "Apple Inc." }, ...]
If you cannot identify a ticker with confidence, skip it. Symbols must be uppercase A-Z, 1-5 characters.`;

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
      tickers.push({
        symbol,
        name: typeof rawName === "string" ? rawName.trim() : "",
      });
    }
  }

  return tickers;
}
