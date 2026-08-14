import "server-only";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\/$/, "");
}

/** Supabase project origin, e.g. https://kbbgyyiasbvgmfoxoeaz.supabase.co */
export const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");

/** Token issuer. Verified live 2026-08-14. */
export const MCP_ISSUER = `${SUPABASE_URL}/auth/v1`;

export const SUPABASE_JWKS_URL = `${MCP_ISSUER}/.well-known/jwks.json`;

/**
 * Public origin of this app. Vercel sets VERCEL_PROJECT_PRODUCTION_URL without a
 * scheme; NEXT_PUBLIC_SITE_URL allows an explicit override for local work.
 */
export const PORTPULSE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")
).replace(/\/$/, "");

export const MCP_RESOURCE_URL = `${PORTPULSE_ORIGIN}/api/mcp`;

/** Mirrors the caps already enforced by app/api/risk/route.ts. */
export const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
export const MAX_SYMBOLS = 60;
