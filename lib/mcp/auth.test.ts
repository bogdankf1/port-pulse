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

const { McpAuthError, createTokenVerifier, authContextFrom, toAuthInfo } =
  await import("./auth");

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
      clientId: "",
      scopes: [],
      expiresAt: expect.any(Number),
    });
  });

  it("reads client_id and splits the scope claim", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(privateKey, {
      sub: "user-123",
      client_id: "client-abc",
      scope: "openid email offline_access",
    });

    await expect(verify(token)).resolves.toMatchObject({
      clientId: "client-abc",
      scopes: ["openid", "email", "offline_access"],
    });
  });

  // Supabase mints aud: "authenticated" for every user token (spec Open
  // Question 3), so a resource-specific audience never appears. This pins that
  // the verifier does not reject on audience — if someone adds a strict check,
  // this fails and sends them to the note in auth.ts.
  it("accepts a token regardless of its audience", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verify(token)).resolves.toMatchObject({ userId: "user-123" });
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

  it("rejects a token whose sub claim is not a string", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER);
    const token = await sign(privateKey, { sub: 12345 });

    await expect(verify(token)).rejects.toBeInstanceOf(McpAuthError);
  });

  // Both key pairs share kid "test-key", so this exercises the stronger case:
  // the kid resolves to a real key and the signature fails against it, rather
  // than short-circuiting on JWKSNoMatchingKey before verification runs.
  it("rejects a token whose signature does not match the resolved key", async () => {
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

// This pair is the only thing standing between a tool handler and a query with
// no user identity, so it is tested directly rather than through a tool.
describe("authContextFrom", () => {
  const ctx = {
    userId: "user-123",
    token: "tok",
    clientId: "client-abc",
    scopes: ["openid"],
    expiresAt: 1786722245,
  };

  it("round-trips a verified context through AuthInfo", () => {
    expect(authContextFrom(toAuthInfo(ctx))).toEqual(ctx);
  });

  it("puts the user id in AuthInfo.extra, not a top-level field", () => {
    expect(toAuthInfo(ctx).extra).toEqual({ userId: "user-123" });
  });

  it("throws when there is no AuthInfo at all", () => {
    expect(() => authContextFrom(undefined)).toThrow(McpAuthError);
  });

  it("throws when AuthInfo carries no userId", () => {
    expect(() =>
      authContextFrom({ token: "tok", clientId: "c", scopes: [] }),
    ).toThrow(McpAuthError);
  });

  it("throws when userId is present but not a string", () => {
    expect(() =>
      authContextFrom({
        token: "tok",
        clientId: "c",
        scopes: [],
        extra: { userId: 12345 },
      }),
    ).toThrow(McpAuthError);
  });

  it("throws when userId is an empty string", () => {
    expect(() =>
      authContextFrom({
        token: "tok",
        clientId: "c",
        scopes: [],
        extra: { userId: "" },
      }),
    ).toThrow(McpAuthError);
  });
});
