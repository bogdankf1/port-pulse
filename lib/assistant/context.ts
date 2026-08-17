import type { McpAuthContext } from "@/lib/mcp/auth";

/**
 * Build the context `lib/mcp/tools.ts` expects from a Supabase **cookie**
 * session.
 *
 * The MCP tool functions were written for the remote connector, which arrives
 * with a bearer token and no cookie. They are reusable here because
 * `createUserClient` only reads `ctx.token` — it sends it as
 * `Authorization: Bearer …` against the **anon** key, so RLS still applies as
 * this user. A cookie session has an access token too, so the two auth models
 * meet here and nowhere else.
 *
 * Do **not** route through `lib/mcp/auth.ts`: that verifies bearer tokens
 * against JWKS for the OAuth flow, which is not what is happening in-app.
 */
export function mcpContextFromSession(
  userId: string,
  accessToken: string,
): McpAuthContext {
  return {
    userId,
    token: accessToken,
    // OAuth bookkeeping the MCP layer records for real clients. No tool body
    // reads either field; they exist to satisfy the shared type.
    clientId: "port-pulse-app",
    scopes: [],
    // Deliberately absent — the cookie session owns refresh, and a fabricated
    // `exp` would be a claim a later caller might act on.
  };
}
