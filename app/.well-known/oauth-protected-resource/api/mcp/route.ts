import {
  generateProtectedResourceMetadata,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";
import { MCP_ISSUER, MCP_RESOURCE_URL } from "@/lib/mcp/config";

export const runtime = "nodejs";

/**
 * RFC 9728 protected resource metadata. This is the document the 401 from
 * /api/mcp points at, and it is how an MCP client discovers which authorization
 * server to use — so it must stay reachable without a token.
 *
 * `resourceUrl` is passed explicitly rather than derived from the request:
 * behind Vercel's proxy the derived origin is not reliably the public one, and
 * a wrong `resource` value here breaks discovery silently.
 */
export function GET() {
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [MCP_ISSUER],
    resourceUrl: MCP_RESOURCE_URL,
    additionalMetadata: {
      scopes_supported: ["openid", "email", "offline_access"],
      bearer_methods_supported: ["header"],
    },
  });

  return Response.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/** Browser-based MCP clients preflight this document before fetching it. */
export const OPTIONS = metadataCorsOptionsRequestHandler();
