import Anthropic from "@anthropic-ai/sdk";
import type { Ticker } from "@/types";

const SYSTEM_PROMPT = `You are parsing a portfolio screenshot from a brokerage app (Robinhood, Interactive Brokers, eToro, etc.).
For every US stock ticker visible in the image, extract:
- symbol: 1-5 uppercase letters (skip crypto, forex, non-US ETFs)
- name: full company name as shown
- quantity: number of shares the user holds, if visible. Look for labels like "Shares", "Qty", "Units", "Position".
- entryPrice: average cost per share, if visible. Look for labels like "Avg Cost", "Average Price", "Cost Basis", "Entry", "Buy Price". This is NOT the current price, NOT the market value, NOT today's change.

Rules:
- Numbers must be plain numbers (no $ signs, no commas, no thousands separators).
- Use null for quantity or entryPrice when you cannot read it. Do not guess.
- If a ticker appears multiple times in one screenshot, return it once with summed quantity and weighted-average entry price.
- If you cannot identify a ticker with confidence, skip it entirely.
- Return an empty list if the image holds no readable tickers.`;

const MODEL = "claude-opus-5";

/**
 * A screenshot of a long holdings list runs to thousands of tokens of JSON.
 * The previous 1024 cap truncated anything past roughly 25 holdings mid-array,
 * which surfaced to the user as "malformed JSON" — indistinguishable from a
 * genuinely unreadable image. 4096 matches app/api/balances/parse and covers
 * well over a hundred rows.
 */
const MAX_TOKENS = 4096;

/**
 * Structured output, the same mechanism app/api/balances/parse uses.
 *
 * This replaces hand-stripping markdown fences off a free-text reply and
 * hoping the remainder parsed. `quantity` and `entryPrice` are
 * required-but-nullable rather than optional for the reason recorded in the
 * balances route: a model allowed to omit a key omits it inconsistently, so
 * half the rows lose a figure that was legible in the image.
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tickers"],
  properties: {
    tickers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "name", "quantity", "entryPrice"],
        properties: {
          symbol: { type: "string", maxLength: 10 },
          name: { type: "string", maxLength: 120 },
          quantity: { type: ["number", "null"] },
          entryPrice: { type: ["number", "null"] },
        },
      },
    },
  },
} as const;

type SupportedMimeType = "image/jpeg" | "image/png" | "image/webp";

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
    max_tokens: MAX_TOKENS,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    // The instructions are the system prompt rather than a trailing text
    // block, which leaves the user turn as the image alone — the shape the
    // vision docs recommend.
    system: SYSTEM_PROMPT,
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
        ],
      },
    ],
  });

  // Checked before the content is trusted, so a cut-off or declined response
  // reports what actually happened instead of failing later as a parse error.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "That screenshot holds more positions than one pass can read. Try splitting it.",
    );
  }
  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to read that image.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }

  let parsed: { tickers?: unknown };
  try {
    parsed = JSON.parse(textBlock.text) as { tickers?: unknown };
  } catch {
    throw new Error("Claude returned malformed JSON");
  }

  const list = Array.isArray(parsed.tickers) ? parsed.tickers : [];

  // Validated here as well as by the schema: the schema fixes the shape, but
  // the model still chooses the values, and a zero or negative quantity would
  // land in the dashboard's totals as garbage.
  const seen = new Set<string>();
  const tickers: Ticker[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.symbol !== "string") continue;
    const symbol = r.symbol.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol)) continue;
    seen.add(symbol);
    tickers.push({
      symbol,
      name: typeof r.name === "string" ? r.name.trim() : "",
      quantity: toFiniteNumber(r.quantity),
      entryPrice: toFiniteNumber(r.entryPrice),
    });
  }

  return tickers;
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}
