/**
 * Starter prompts for an empty conversation. All are answerable from the six
 * tools, and none invites trade advice — the app is analysis-only.
 */
export const STARTER_PROMPTS: readonly string[] = [
  "What are my biggest risks right now?",
  "How concentrated is this portfolio?",
  "How diversified am I by sector?",
  "What's driving today's moves?",
  "If the market dropped 10%, which positions would hurt most?",
  "Which of my holdings duplicate each other's exposure?",
  "What's my best and worst performer?",
  "How have I done against the S&P 500 this year?",
  "Is my beta what I'd expect from these holdings?",
  "Which positions contribute most to my volatility?",
  "Walk me through my sector allocation.",
  "Summarise this portfolio for someone seeing it for the first time.",
  "What's changed most in the last month?",
  "How much of my gain comes from a single holding?",
  "What should I understand about this portfolio that isn't obvious?",
] as const;

/**
 * Pick `count` distinct starters.
 *
 * `random` is injected so this is testable and so the caller controls *when*
 * randomness happens — it must not run during render, or the server and client
 * markup disagree and React reports a hydration mismatch.
 */
export function pickStarters(
  count: number,
  random: () => number = Math.random,
): string[] {
  const pool = [...STARTER_PROMPTS];
  const take = Math.min(count, pool.length);
  const out: string[] = [];
  for (let i = 0; i < take; i++) {
    const idx = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * The system prompt has four jobs: frame which portfolio the user is looking
 * at, force every number through a tool, state the read-only boundary, and
 * keep the answer short. This model defaults verbose.
 */
export function buildSystemPrompt(args: {
  activePortfolioName: string | null;
}): string {
  const viewing = args.activePortfolioName
    ? `The user is currently looking at their portfolio named "${args.activePortfolioName}". ` +
      `Assume questions are about that portfolio unless they say otherwise.`
    : `The user has not selected a portfolio. Call list_portfolios first to see what they have.`;

  return [
    "You are the Port Pulse assistant. You help one person understand their own investment portfolio.",
    "",
    viewing,
    "",
    "Grounding. Every number you state must come from a tool call in this turn.",
    "Never reuse a figure from an earlier turn: prices move, so a remembered",
    "number is a wrong number. If a tool fails, say which one and what you could",
    "not determine — do not estimate around it.",
    "",
    "Boundaries. Port Pulse is read-only and for analysis only. You cannot and",
    "must not place trades, move money, or change anything in the user's account.",
    "You can explain what a holding is, what the portfolio's exposures and risks",
    "are, and what the numbers mean. Do not tell the user what to buy or sell.",
    "",
    "Style. Lead with the answer, then the supporting detail. Keep it short —",
    "a sentence or two for a simple question. Use the ticker symbols the user",
    "uses. Format money and percentages the way a broker statement would.",
    "Do not restate the question back before answering it.",
  ].join("\n");
}
