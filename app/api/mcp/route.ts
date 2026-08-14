import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { PORTPULSE_ORIGIN } from "@/lib/mcp/config";
import {
  McpAuthError,
  authContextFrom,
  toAuthInfo,
  verifyToken,
} from "@/lib/mcp/auth";
import {
  getPortfolio,
  getPortfolioSchema,
  getPosition,
  getPositionSchema,
  getPriceHistory,
  getPriceHistorySchema,
  listPortfolios,
  listPortfoliosSchema,
} from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Path only — withMcpAuth appends it to the origin to build the 401's URL. */
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/api/mcp";

/** Tools return JSON as text; MCP has no richer typed-result contract here. */
function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_portfolios",
      {
        title: "List portfolios",
        description:
          "List the signed-in user's Port Pulse portfolios with a holdings count.",
        inputSchema: listPortfoliosSchema,
      },
      async (_args, ctx) =>
        jsonResult(await listPortfolios(authContextFrom(ctx.http?.authInfo))),
    );

    server.registerTool(
      "get_portfolio",
      {
        title: "Get portfolio",
        description:
          "Get one portfolio's holdings with current prices, unrealized P&L and " +
          "weights. Identify it by portfolio_id, or by name if you already " +
          "listed portfolios.",
        inputSchema: getPortfolioSchema,
      },
      async (args, ctx) =>
        jsonResult(await getPortfolio(authContextFrom(ctx.http?.authInfo), args)),
    );

    server.registerTool(
      "get_position",
      {
        title: "Get position",
        description:
          "Get the user's total exposure to one ticker, aggregated across every " +
          "portfolio.",
        inputSchema: getPositionSchema,
      },
      async (args, ctx) =>
        jsonResult(await getPosition(authContextFrom(ctx.http?.authInfo), args)),
    );

    server.registerTool(
      "get_price_history",
      {
        title: "Get price history",
        description:
          "Get a price history series for one ticker over 1D, 1M, 3M, YTD, 1Y or 5Y.",
        inputSchema: getPriceHistorySchema,
      },
      async (args, ctx) =>
        jsonResult(await getPriceHistory(authContextFrom(ctx.http?.authInfo), args)),
    );
  },
  { serverInfo: { name: "port-pulse", version: "1.0.0" } },
);

const authenticated = withMcpAuth(
  handler,
  async (_req, bearer): Promise<AuthInfo | undefined> => {
    if (!bearer) return undefined;
    try {
      return toAuthInfo(await verifyToken(bearer));
    } catch (err) {
      // A bad token is a 401, not a 500. Anything else is a real fault (JWKS
      // unreachable, for instance) and must not be reported as invalid_token.
      if (err instanceof McpAuthError) return undefined;
      throw err;
    }
  },
  {
    required: true,
    resourceMetadataPath: RESOURCE_METADATA_PATH,
    resourceUrl: PORTPULSE_ORIGIN,
  },
);

export { authenticated as GET, authenticated as POST, authenticated as DELETE };
