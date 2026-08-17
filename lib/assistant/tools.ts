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

/**
 * Every tool the assistant can reach. All six are read-only, which is how the
 * "analysis only, never writes" constraint is satisfied — structurally, by the
 * absence of a write path, rather than by instruction.
 */
export const TOOL_NAMES = [
  "list_portfolios",
  "get_portfolio",
  "get_position",
  "get_price_history",
  "get_risk_metrics",
  "get_sector_breakdown",
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
  const jsonSchema = z.toJSONSchema(options.inputSchema, {
    io: "input",
    reused: "ref",
  });
  if (jsonSchema.type !== "object") {
    throw new Error(
      `Zod schema for tool "${options.name}" must be an object, but got ${jsonSchema.type}`,
    );
  }
  return {
    type: "custom" as const,
    name: options.name,
    input_schema: jsonSchema,
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
  ];
}
