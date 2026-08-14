import { describe, expect, it, vi } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWK,
} from "jose";
// `./auth` imports `./config`, which imports the `server-only` marker package.
// That package throws unconditionally unless resolved via Next.js's bundler
// (which aliases it to a no-op through the "react-server" export condition).
// Vitest runs under plain Node resolution, so stub it out here. Vitest hoists
// `vi.mock` calls above imports, so this still applies before `./auth` loads.
vi.mock("server-only", () => ({}));

// `./config` also requires NEXT_PUBLIC_SUPABASE_URL to be set at import time.
// It's unused by createTokenVerifier (only verifyToken reads it), but the
// module throws on load if it's missing, so provide a placeholder for tests.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";

const { McpAuthError, createTokenVerifier } = await import("./auth");

const ISSUER = "https://example.supabase.co/auth/v1";

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = "test-key";
  jwk.alg = "ES256";
  return { privateKey, keySet: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  expiry = "5m",
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(expiry)
    .sign(privateKey);
}

describe("createTokenVerifier", () => {
  it("returns the user id from a valid token", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(privateKey, { sub: "user-123" });

    await expect(verify(token)).resolves.toEqual({
      userId: "user-123",
      token,
    });
  });

  it("rejects a token from a different issuer", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer("https://attacker.example/auth/v1")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verify(token)).rejects.toBeInstanceOf(McpAuthError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(privateKey, { sub: "user-123" }, "-1s");

    await expect(verify(token)).rejects.toBeInstanceOf(McpAuthError);
  });

  it("rejects a token with no sub claim", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(privateKey, { email: "a@b.c" });

    await expect(verify(token)).rejects.toBeInstanceOf(McpAuthError);
  });

  it("rejects a token signed by an unknown key", async () => {
    const { keySet } = await makeKeys();
    const other = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(other.privateKey, { sub: "user-123" });

    await expect(verify(token)).rejects.toBeInstanceOf(McpAuthError);
  });

  it("rejects a tampered token", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(privateKey, { sub: "user-123" });
    const tampered = `${token.slice(0, -4)}AAAA`;

    await expect(verify(tampered)).rejects.toBeInstanceOf(McpAuthError);
  });
});
