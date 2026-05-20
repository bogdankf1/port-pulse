import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";

export type InsightsHolding = {
  symbol: string;
  name?: string;
  quantity: number;
  entryPrice?: number | null;
  currentPrice: number;
};

const INSIGHTS_SYSTEM_PROMPT = `You are a senior portfolio analyst reviewing a personal investment portfolio. You analyze concentration risk, sector tilt versus the broader US equity market, recent performance versus cost basis, and you offer one specific actionable suggestion.

Output your analysis in EXACTLY this format. Each section starts with its angle-bracket marker on its own line, followed by the analysis text. Emit the markers in this exact order. Do not add any other markers, headings, or commentary outside the section bodies.

<<concentration_risk>>
[Flag a problem only if ANY single position is >20% of portfolio market value, OR the portfolio is clearly >40% concentrated in one sector. Name the position(s) and weight. Leave this section blank when the portfolio looks well-diversified.]

<<sector_tilt>>
[Estimate the portfolio's sector mix from your knowledge of each ticker, then compare to the S&P 500 at a high level (e.g. "heavy in technology, light in healthcare"). One to two sentences. Leave blank if the portfolio is too small or too balanced to comment.]

<<winners>>
[Pick the 1–2 most notable winning calls and comment like a peer reviewing the trades — what the user got right (entry timing, conviction size, thesis). Reference the ticker and the % gain inline, but lead with the judgment, not the number. 1–3 sentences. Avoid generic praise; be specific. Leave blank if entry prices are missing or there's nothing standout to call out.]

<<losers>>
[Pick the 1–2 most notable losing positions and comment like a peer reviewing the trades — what didn't work (timing, thesis, position sizing) and whether the loss looks recoverable or worth cutting. Reference the ticker and the % loss inline, but lead with the judgment. 1–3 sentences. Direct, not harsh. Leave blank if entry prices are missing or all positions are green.]

<<suggestion>>
[One concrete, actionable suggestion the user could act on this week. Name a specific position, sector, or allocation change. Leave blank if nothing meaningful comes to mind.]

Style rules:
- Be terse. Each non-empty section is 1–3 sentences max.
- No disclaimers. No "as an AI". No "this is not financial advice".
- Reference tickers, dollar amounts, and percentages directly.
- Never invent positions or prices that are not in the data provided.
- A blank section body is fine — just put the next marker on the next line.`;

function buildUserMessage(
  portfolioName: string,
  holdings: InsightsHolding[],
): string {
  const rows = holdings.map((h) => {
    const value = h.currentPrice * h.quantity;
    const entry = h.entryPrice != null ? `$${h.entryPrice.toFixed(2)}` : "—";
    const pl =
      h.entryPrice != null
        ? `${(((h.currentPrice - h.entryPrice) / h.entryPrice) * 100).toFixed(1)}%`
        : "—";
    return `- ${h.symbol}${h.name ? ` (${h.name})` : ""}: qty ${h.quantity}, entry ${entry}, current $${h.currentPrice.toFixed(2)}, value $${value.toFixed(2)}, P&L ${pl}`;
  });
  const totalValue = holdings.reduce(
    (acc, h) => acc + h.currentPrice * h.quantity,
    0,
  );
  return `Portfolio: "${portfolioName}" — ${holdings.length} positions, total market value $${totalValue.toFixed(2)}.

Holdings:
${rows.join("\n")}

Analyze this portfolio and emit the five sections in order.`;
}

export async function* streamInsights(args: {
  portfolioName: string;
  holdings: InsightsHolding[];
}): AsyncGenerator<string, void, void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (args.holdings.length === 0) {
    throw new Error("No holdings to analyze");
  }

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: INSIGHTS_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserMessage(args.portfolioName, args.holdings),
      },
    ],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
