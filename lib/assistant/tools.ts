import { z, type ZodType } from "zod";
import type { McpAuthContext } from "@/lib/mcp/auth";
import {
  getPortfolio,
  getPortfolioSchema,
  getPosition,
  getPositionSchema,
  getPriceHistory,
  getPriceHistorySchema,
  getRiskMetrics,
  getRiskMetricsSchema,
  getSectorBreakdown,
  getSectorBreakdownSchema,
  listPortfolios,
  listPortfoliosSchema,
} from "@/lib/mcp/tools";
import {
  comparePortfolios,
  comparePortfoliosSchema,
  getCorrelation,
  getCorrelationSchema,
  getPortfolioHistory,
  getPortfolioHistorySchema,
} from "@/lib/mcp/analysis";
import {
  getCompanyFundamentals,
  getCompanyFundamentalsSchema,
  getEarningsCalendar,
  getEarningsCalendarSchema,
  getMarketContext,
  getMarketContextSchema,
  searchSymbol,
  searchSymbolSchema,
} from "@/lib/mcp/market";
import { convertCurrency, convertCurrencySchema } from "@/lib/mcp/fx";
import { calculateSchema, evaluate } from "@/lib/calc";

/**
 * Every custom tool the assistant can reach. All of them are read-only, which
 * is how the "analysis only, never writes" constraint is satisfied —
 * structurally, by the absence of a write path, rather than by instruction.
 * `calculate` evaluates a closed arithmetic grammar with no identifiers, so it
 * is read-only in the same structural sense.
 *
 * The hosted `web_search` tool is declared separately in `loop.ts`; it runs on
 * Anthropic's side and so has no `run` function to bind here.
 */
export const TOOL_NAMES = [
  "list_portfolios",
  "get_portfolio",
  "get_position",
  "get_price_history",
  "get_portfolio_history",
  "compare_portfolios",
  "get_risk_metrics",
  "get_sector_breakdown",
  "get_correlation",
  "search_symbol",
  "get_company_fundamentals",
  "get_earnings_calendar",
  "get_market_context",
  "convert_currency",
  "calculate",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Tool results go back to the model as JSON text, as the MCP route does. */
function asText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Same contract as the SDK's `betaZodTool` (@anthropic-ai/sdk/helpers/beta/zod),
 * reimplemented locally because that helper cannot be used as-is here.
 *
 * `betaZodTool` builds `input_schema` by calling zod's `toJSONSchema` in its
 * default "output" mode, with no option to change that. Two of the six MCP
 * schemas — `getPositionSchema` and `getPriceHistorySchema` — normalize
 * `symbol` with `.transform(...)`, and zod v4 refuses to represent a
 * transform in "output" mode: `toJSONSchema` throws "Transforms cannot be
 * represented in JSON Schema", so `betaZodTool` throws while building the
 * tool list. This is a real, verified SDK behavior (checked against
 * node_modules/@anthropic-ai/sdk/helpers/beta/zod.js and zod's
 * json-schema-processors.js `transformProcessor`), not a version fluke —
 * the same helper in @anthropic-ai/sdk 0.117.1 (latest, checked via
 * `npm view`) still calls `toJSONSchema` with no `io` override.
 *
 * `toJSONSchema(schema, { io: "input" })` instead describes the schema's
 * pre-transform shape — which is the correct thing for a tool's
 * `input_schema` to describe in the first place, since it documents what the
 * model must send, not what validation produces from it. This does not touch
 * `.parse()`: that still runs the original schema, transform included, so
 * `run` (which the SDK's own ToolRunner feeds through `.parse()` first) still
 * gets trimmed, upper-cased, ticker-validated input exactly as the MCP route
 * does. Only the JSON Schema shown to the model changes, and only by losing
 * the pattern constraint on `symbol` — the tool description still says what a
 * ticker looks like.
 */
function zodTool<InputSchema extends ZodType>(options: {
  name: string;
  description: string;
  inputSchema: InputSchema;
  run: (args: z.infer<InputSchema>) => Promise<string>;
}) {
  // `reused: "ref"` (which `betaZodTool` passes) is deliberately omitted. Under
  // `io: "input"` it hoists the transformed `symbol` into a single-use
  // `$defs/__schema0` holding nothing but `{"type":"string"}` — an indirection
  // that costs tokens on every request and buys nothing for schemas this flat.
  // The default inlines it. None of the six schemas is recursive, which is the
  // only case where the ref form would be required.
  const jsonSchema = z.toJSONSchema(options.inputSchema, { io: "input" });
  if (jsonSchema.type !== "object") {
    throw new Error(
      `Zod schema for tool "${options.name}" must be an object, but got ${jsonSchema.type}`,
    );
  }
  // TypeScript does not narrow `jsonSchema.type` from the check above — it stays
  // the wide `"string" | "object" | … | undefined` union — while the SDK's
  // `BetaTool.InputSchema` requires the literal `"object"`. Without this the
  // whole tool array is unassignable to `toolRunner`'s `tools` parameter. The
  // SDK's own `betaZodTool` asserts at the same spot for the same reason.
  // Scoped to the single field the runtime check immediately above just proved.
  const inputSchema = jsonSchema as typeof jsonSchema & { type: "object" };
  return {
    type: "custom" as const,
    name: options.name,
    input_schema: inputSchema,
    description: options.description,
    run: options.run,
    parse: (args: unknown) => options.inputSchema.parse(args),
  };
}

/**
 * Bind the six MCP tool functions to one user's context.
 *
 * Descriptions are copied from `app/api/mcp/route.ts` on purpose: the remote
 * connector and the in-app assistant should describe the same tool the same
 * way, and divergence there is invisible until the model starts choosing badly.
 */
export function assistantTools(ctx: McpAuthContext) {
  return [
    zodTool({
      name: "list_portfolios",
      description:
        "List the signed-in user's Port Pulse portfolios with a holdings count.",
      inputSchema: listPortfoliosSchema,
      run: async () => asText(await listPortfolios(ctx)),
    }),
    zodTool({
      name: "get_portfolio",
      description:
        "Get one portfolio's holdings with current prices, unrealized P&L and " +
        "weights. Identify it by portfolio_id, or by name if you already " +
        "listed portfolios.",
      inputSchema: getPortfolioSchema,
      run: async (args) => asText(await getPortfolio(ctx, args)),
    }),
    zodTool({
      name: "get_position",
      description:
        "Get the user's total exposure to one ticker, aggregated across every " +
        "portfolio.",
      inputSchema: getPositionSchema,
      run: async (args) => asText(await getPosition(ctx, args)),
    }),
    zodTool({
      name: "get_price_history",
      description:
        "Get a price history series for one ticker over 1D, 1M, 3M, YTD, 1Y or 5Y.",
      inputSchema: getPriceHistorySchema,
      run: async (args) => asText(await getPriceHistory(ctx, args)),
    }),
    zodTool({
      name: "get_risk_metrics",
      description:
        "Get Sharpe ratio, beta, annualized volatility and max drawdown for a " +
        "portfolio over the last year, benchmarked against SPY.",
      inputSchema: getRiskMetricsSchema,
      run: async (args) => asText(await getRiskMetrics(ctx, args)),
    }),
    zodTool({
      name: "get_sector_breakdown",
      description:
        "Break a portfolio down by sector, with value, percentage and " +
        "constituent tickers.",
      inputSchema: getSectorBreakdownSchema,
      run: async (args) => asText(await getSectorBreakdown(ctx, args)),
    }),
    zodTool({
      name: "get_portfolio_history",
      description:
        "Get how one portfolio's total value moved over 1D, 1M, 3M, YTD or 1Y, " +
        "with start and end value and percentage change. Use this for " +
        "\"how have I done\" questions — get_price_history covers one ticker, " +
        "this covers the whole portfolio.",
      inputSchema: getPortfolioHistorySchema,
      run: async (args) => asText(await getPortfolioHistory(ctx, args)),
    }),
    zodTool({
      name: "compare_portfolios",
      description:
        "Compare two to four portfolios' returns over the same window, " +
        "against SPY. Use when the user asks which of their portfolios did better.",
      inputSchema: comparePortfoliosSchema,
      run: async (args) => asText(await comparePortfolios(ctx, args)),
    }),
    zodTool({
      name: "get_correlation",
      description:
        "Pairwise correlation of daily returns over the last year for two to " +
        "twelve tickers. Use for genuine diversification questions — two " +
        "holdings in different sectors can still move together.",
      inputSchema: getCorrelationSchema,
      run: async (args) => asText(await getCorrelation(ctx, args)),
    }),
    zodTool({
      name: "search_symbol",
      description:
        "Resolve a company name to a ticker symbol. Use when the user names a " +
        "company rather than a ticker.",
      inputSchema: searchSymbolSchema,
      run: async (args) => asText(await searchSymbol(args)),
    }),
    zodTool({
      name: "get_company_fundamentals",
      description:
        "Valuation and quality figures for one ticker: P/E, EPS, market cap, " +
        "beta, 52-week high/low and return, dividend yield, revenue growth, ROE.",
      inputSchema: getCompanyFundamentalsSchema,
      run: async (args) => asText(await getCompanyFundamentals(args)),
    }),
    zodTool({
      name: "get_earnings_calendar",
      description:
        "Upcoming earnings dates for the given tickers, with EPS estimates. " +
        "Defaults to the next 30 days.",
      inputSchema: getEarningsCalendarSchema,
      run: async (args) => asText(await getEarningsCalendar(args)),
    }),
    zodTool({
      name: "get_market_context",
      description:
        "Today's move for the S&P 500, Nasdaq 100 and Dow ETFs. Use to say " +
        "whether a portfolio move is its own or the whole market's.",
      inputSchema: getMarketContextSchema,
      run: async () => asText(await getMarketContext()),
    }),
    zodTool({
      name: "convert_currency",
      description:
        "Convert an amount between currencies at the current rate — USD, EUR " +
        "and UAH are supported in both directions, as are most other 3-letter " +
        "codes. Use whenever the user asks for a figure in another currency.",
      inputSchema: convertCurrencySchema,
      run: async (args) => asText(await convertCurrency(args)),
    }),
    zodTool({
      name: "calculate",
      description:
        "Evaluate an arithmetic expression exactly. Use this for every " +
        "calculation you would otherwise do in your head — totals, " +
        "differences, weights, what-if sizing — so the arithmetic in your " +
        "answer is never approximate.",
      inputSchema: calculateSchema,
      run: async (args) => {
        // A malformed expression is the model's mistake to correct, not a
        // turn-ending failure: return it as a result so it can retry.
        try {
          return asText({ expression: args.expression, result: evaluate(args.expression) });
        } catch (err) {
          return asText({
            expression: args.expression,
            error: err instanceof Error ? err.message : "Could not evaluate",
          });
        }
      },
    }),
  ];
}
