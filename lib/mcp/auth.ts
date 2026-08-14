import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { MCP_ISSUER, SUPABASE_JWKS_URL } from "./config";

export class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthError";
  }
}

export type McpAuthContext = {
  /** Supabase user id, from the token's `sub` claim. */
  userId: string;
  /** The raw bearer token, retained so tools can act as this user. */
  token: string;
};

export function createTokenVerifier(keySet: JWTVerifyGetKey, issuer: string) {
  return async function verifyToken(token: string): Promise<McpAuthContext> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(token, keySet, { issuer }));
    } catch (err) {
      throw new McpAuthError(
        err instanceof Error ? err.message : "token verification failed",
      );
    }

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      throw new McpAuthError("token has no sub claim");
    }

    return { userId: sub, token };
  };
}

let cachedRemoteKeySet: JWTVerifyGetKey | undefined;

/** Production verifier. The remote key set caches and rotates keys internally. */
export async function verifyToken(token: string) {
  cachedRemoteKeySet ??= createRemoteJWKSet(new URL(SUPABASE_JWKS_URL));
  return createTokenVerifier(cachedRemoteKeySet, MCP_ISSUER)(token);
}
