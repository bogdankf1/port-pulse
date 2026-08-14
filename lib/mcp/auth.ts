import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { MCP_ISSUER, SUPABASE_JWKS_URL } from "./config";

export class McpAuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpAuthError";
  }
}

export type McpAuthContext = {
  /** Supabase user id, from the token's `sub` claim. */
  userId: string;
  /** The raw bearer token, retained so tools can act as this user. */
  token: string;
  /** OAuth client the token was issued to, when the claim is present. */
  clientId: string;
  /** Granted scopes, split from the space-delimited `scope` claim. */
  scopes: string[];
  /** Expiry in seconds since the epoch, from `exp`. */
  expiresAt?: number;
};

/**
 * There is deliberately no audience check.
 *
 * Verified live 2026-08-14 (spec Open Question 3): Supabase ignores the RFC 8707
 * `resource` parameter and mints every user token with the constant
 * `aud: "authenticated"`. There is nothing resource-specific to bind to, so a
 * strict audience check cannot be satisfied and must not be added here.
 *
 * The consequence, recorded so it is not rediscovered as a surprise: any token
 * this Supabase project issues for a user is accepted at /api/mcp — including an
 * ordinary web-app session token, not just one issued to an OAuth client. That
 * is tolerable only because every tool is read-only and returns exactly the rows
 * RLS already grants that token. Do not add a write tool without first solving
 * audience binding.
 */
export function createTokenVerifier(keySet: JWTVerifyGetKey, issuer: string) {
  return async function verifyToken(token: string): Promise<McpAuthContext> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, keySet, { issuer }));
    } catch (err) {
      // jose's claim-validation messages name which check failed but never echo
      // claim values or key material, so they are safe to surface. The cause is
      // kept for server-side logs.
      throw new McpAuthError(
        err instanceof Error ? err.message : "token verification failed",
        { cause: err },
      );
    }

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      throw new McpAuthError("token has no sub claim");
    }

    // clientId and scopes are reported to the MCP SDK as AuthInfo. They are
    // descriptive only — nothing is authorized on their basis, because a token
    // minted for any client is equally valid here (see the note above).
    const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];
    const expiresAt = typeof payload.exp === "number" ? payload.exp : undefined;

    return { userId: sub, token, clientId, scopes, expiresAt };
  };
}

let cachedRemoteKeySet: JWTVerifyGetKey | undefined;

/** Production verifier. The remote key set caches and rotates keys internally. */
export async function verifyToken(token: string) {
  cachedRemoteKeySet ??= createRemoteJWKSet(new URL(SUPABASE_JWKS_URL));
  return createTokenVerifier(cachedRemoteKeySet, MCP_ISSUER)(token);
}
