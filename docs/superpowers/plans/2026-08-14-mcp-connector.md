# Port Pulse MCP Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only remote MCP server at `https://port-pulse-seven.vercel.app/api/mcp` so a signed-in Port Pulse user can add it to claude.ai as a custom connector and ask Claude about their real portfolios.

**Architecture:** Supabase Auth acts as the OAuth 2.1 authorization server (already enabled); the existing Next.js app acts as the OAuth resource server and hosts the MCP endpoint. A consent page at `/oauth/consent` completes Supabase's authorization flow. Six read-only tools query Supabase and Yahoo through helpers the app already has.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Auth + Postgres + RLS), `mcp-handler` 2.x, `@modelcontextprotocol/server` 2.x, `jose` (JWKS verification), `zod` 4.x, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-mcp-connector-design.md`

---

## Two things to know before starting

**1. Task 1 adds Vitest to a project that currently has no tests.** This is a
deliberate addition, not a spec requirement. It is here because Tasks 4 and 10
write security-critical token verification and money math, and those are exactly
the things worth pinning down with tests. If the owner would rather not adopt a
test framework, skip Task 1 and verify Tasks 4 and 10 by running the app instead —
the rest of the plan is unaffected.

**2. Task 6 is a knowledge-gathering task, not a code task, and the tasks after it
branch on what it finds.** Open Questions 2 and 3 in the spec cannot be answered
without a real access token. Do not skip ahead and guess. Task 7 explicitly encodes
both branches.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/mcp/config.ts` | Resolved constants: issuer, JWKS URL, origin, resource URL. Single source of truth for every URL. |
| `lib/mcp/auth.ts` | Bearer token → `{ userId }`. Verification only; no data access. |
| `lib/mcp/supabase.ts` | Builds a Supabase client scoped to the authenticated user. Isolates the Open Question 2 decision to one file. |
| `lib/mcp/quotes.ts` | Symbol → current price, via `fetchYahooChart`. Isolates Yahoo failure handling. |
| `lib/mcp/portfolio.ts` | Pure math: holdings, market value, P&L, weights, totals. No I/O, fully testable. |
| `lib/mcp/types.ts` | Tool output types shared across tools. |
| `lib/mcp/tools.ts` | Tool registration: zod input schemas + handlers. |
| `app/api/mcp/route.ts` | The MCP endpoint. Wiring only. |
| `app/.well-known/oauth-protected-resource/api/mcp/route.ts` | RFC 9728 metadata (path subject to Task 8). |
| `app/oauth/consent/page.tsx` | Consent UI. |

Splitting `quotes` and `supabase` out of `tools.ts` keeps the two unresolved
questions (Yahoo failure shape, RLS vs service-role) each contained in one small
file, so resolving them later touches one file rather than six tool handlers.

---

### Task 1: Add a test harness

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install -D vitest vite-tsconfig-paths
```

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

`vite-tsconfig-paths` is required for the `@/` alias in `tsconfig.json` to resolve
inside tests.

- [ ] **Step 3: Add scripts to `package.json`**

In the `"scripts"` block, alongside the existing `dev` / `build` / `start` / `lint`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Verify the runner starts**

Run: `npm test`
Expected: exits 0 with "No test files found" (no tests exist yet). If it errors on
config parsing, fix that before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest harness for lib/ unit tests"
```

---

### Task 2: Install connector dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install mcp-handler @modelcontextprotocol/server jose zod
```

`mcp-handler` 2.x requires `@modelcontextprotocol/server` ^2.0.0, `zod` ^4.2, and
Node 20+. Local Node is v22.23.1, which satisfies this.

- [ ] **Step 2: Verify the installed major versions match expectations**

Run: `npm ls mcp-handler @modelcontextprotocol/server zod jose`
Expected: `mcp-handler@2.x`, `@modelcontextprotocol/server@2.x`, `zod@4.x`.

If `mcp-handler` resolved to 1.x, stop — the 1.x API differs and every later task
that touches `createMcpHandler` / `withMcpAuth` assumes 2.x.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add mcp-handler, MCP server SDK, jose and zod"
```

---

### Task 3: Connector configuration constants

**Files:**
- Create: `lib/mcp/config.ts`

- [ ] **Step 1: Write `lib/mcp/config.ts`**

```typescript
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
 *
 * Uses `||` rather than `??` deliberately: a declared-but-empty env var must fall
 * through, not win. An empty NEXT_PUBLIC_SITE_URL under `??` yields an empty
 * origin and a relative MCP_RESOURCE_URL, which is published to Claude in the
 * metadata document and read as an absolute resource identifier.
 */
export const PORTPULSE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000")
).replace(/\/$/, "");

export const MCP_RESOURCE_URL = `${PORTPULSE_ORIGIN}/api/mcp`;

/** Mirrors the caps already enforced by app/api/risk/route.ts. */
export const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
export const MAX_SYMBOLS = 60;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/mcp/config.ts
git commit -m "feat(mcp): add connector configuration constants"
```

---

### Task 4: Bearer token verification

Verification is injectable so tests can sign tokens with a locally generated key
instead of reaching the network.

**Files:**
- Create: `lib/mcp/auth.ts`
- Test: `lib/mcp/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type KeyLike,
} from "jose";
import { McpAuthError, createTokenVerifier } from "./auth";

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
  privateKey: KeyLike,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/mcp/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Write `lib/mcp/auth.ts`**

```typescript
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
```

Note there is deliberately no audience check yet — Task 7 adds one if and only if
Task 6 shows the authorization server can issue audience-bound tokens.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mcp/auth.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/auth.ts lib/mcp/auth.test.ts
git commit -m "feat(mcp): verify Supabase-issued bearer tokens via JWKS"
```

---

### Task 5: Consent page

Supabase redirects here with `?authorization_id=…` during the authorization code
flow. Without this page the flow dead-ends, so it must exist before any token can
be obtained.

**Files:**
- Create: `app/oauth/consent/page.tsx`

- [ ] **Step 1: Confirm the client SDK method names against the installed package**

Run: `grep -rn "getAuthorizationDetails\|approveAuthorization\|denyAuthorization" node_modules/@supabase/supabase-js/dist/module/ | head -20`
Expected: matches under an `oauth` namespace on the auth client.

If there are no matches, the installed `@supabase/supabase-js` (currently ^2.105.3)
predates the OAuth server client methods. Upgrade to the latest v2 and re-run
before writing the page. **Do not hand-roll calls to the authorize endpoint** —
Supabase expects the `authorization_id` handshake to go through these methods.

- [ ] **Step 2: Write `app/oauth/consent/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { getUser, isAuthReady, signInWithGoogle } from "@/lib/auth";

type Details = {
  client_name?: string;
  redirect_uri?: string;
  scopes?: string[];
};

export default function ConsentPage() {
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(
      "authorization_id",
    );
    if (!id) {
      setError("Missing authorization_id. Start the connection from Claude.");
      return;
    }
    setAuthorizationId(id);

    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured.");
      return;
    }
    if (isAuthReady() && !getUser()) {
      void signInWithGoogle();
      return;
    }

    const supabase = createBrowserSupabase();
    supabase.auth.oauth
      .getAuthorizationDetails(id)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setDetails(data as Details);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load request"),
      );
  }, []);

  const decide = useCallback(
    async (approve: boolean) => {
      if (!authorizationId) return;
      setBusy(true);
      const supabase = createBrowserSupabase();
      const { data, error: err } = approve
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      const redirect = (data as { redirect_url?: string })?.redirect_url;
      if (redirect) window.location.href = redirect;
      else setError("No redirect returned by Supabase.");
    },
    [authorizationId],
  );

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <p className="font-mono text-sm text-red-400">{error}</p>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
        <p className="font-mono text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Connect {details.client_name ?? "an application"}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          It will be able to read your portfolios and holdings. It cannot change
          or delete anything.
        </p>
      </div>

      <dl className="space-y-2 rounded-lg border border-neutral-800 p-4 font-mono text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">Redirects to</dt>
          <dd className="truncate text-neutral-300">{details.redirect_uri}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-neutral-500">Scopes</dt>
          <dd className="text-neutral-300">
            {(details.scopes ?? []).join(", ") || "—"}
          </dd>
        </div>
      </dl>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(true)}
          className="flex-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
          className="flex-1 rounded-md border border-neutral-700 px-4 py-2 text-sm disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
```

If Step 1 showed different method or response-field names, use the names from the
installed package rather than these.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds and `/oauth/consent` appears in the route list.

- [ ] **Step 4: Commit and deploy**

```bash
git add app/oauth/consent/page.tsx
git commit -m "feat(oauth): add consent screen for Supabase OAuth server"
git push -u origin feat/mcp-connector
```

Then deploy this branch to Vercel (a preview deploy is fine, but the OAuth
redirect must match the Site URL — if the preview URL differs, use production).

- [ ] **Step 5: Verify sign-in still works on production**

Visit `https://port-pulse-seven.vercel.app`, sign in with Google, confirm the
dashboard loads. This is spec build-order step 1 and it gates everything after.

---

### Task 6: Register a client by hand and inspect a real token

**No code.** This resolves spec Open Questions 2 and 3. Record the findings in the
spec before writing Task 7.

- [ ] **Step 1: Register an OAuth client**

Supabase dashboard → Authentication → OAuth Apps → register a client:
- Name: `MCP Probe`
- Redirect URI: `http://localhost:8080/callback`
- Type: public (so PKCE is used and no secret is needed)

Record the client ID.

- [ ] **Step 2: Run the authorization code flow**

Generate a PKCE pair, then open the authorize URL in a browser:

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
echo "verifier: $VERIFIER"
echo "https://kbbgyyiasbvgmfoxoeaz.supabase.co/auth/v1/oauth/authorize?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid%20email%20offline_access&code_challenge=$CHALLENGE&code_challenge_method=S256&resource=https%3A%2F%2Fport-pulse-seven.vercel.app%2Fapi%2Fmcp"
```

The `resource` parameter is included deliberately — whether it influences the
issued token is exactly what this task measures.

You will be redirected through `/oauth/consent`. Approve. The browser then fails
to load `localhost:8080` — that is expected; copy the `code` from the URL bar.

- [ ] **Step 3: Exchange the code for a token**

```bash
curl -sS -X POST "https://kbbgyyiasbvgmfoxoeaz.supabase.co/auth/v1/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=<CODE>" \
  -d "client_id=<CLIENT_ID>" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "code_verifier=$VERIFIER"
```

- [ ] **Step 4: Decode the access token and record the claims**

```bash
echo '<ACCESS_TOKEN>' | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
```

Record: `aud`, `sub`, `role`, and whether any claim references the MCP resource
URL.

**Open Question 3 is answered:** if `aud` is the MCP resource URL, audience binding
works. If `aud` is the client ID or the Supabase project, it does not.

- [ ] **Step 5: Test whether the token satisfies RLS**

```bash
curl -sS "https://kbbgyyiasbvgmfoxoeaz.supabase.co/rest/v1/portfolios?select=id,name" \
  -H "apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

**Open Question 2 is answered:** rows returned means `auth.uid()` resolves and the
RLS path works. An empty array or a permission error means it does not, and Task 7
takes the service-role branch.

- [ ] **Step 6: Record both answers in the spec**

Edit `docs/superpowers/specs/2026-08-14-mcp-connector-design.md`, replacing the
text of Open Questions 2 and 3 with what was observed and the date.

```bash
git add docs/superpowers/specs/2026-08-14-mcp-connector-design.md
git commit -m "docs: resolve MCP connector open questions 2 and 3 against a live token"
```

---

### Task 7: User-scoped Supabase client (branches on Task 6)

**Files:**
- Create: `lib/mcp/supabase.ts`
- Modify (branch B of Step 2 only): `lib/mcp/auth.ts`

- [ ] **Step 1: Write `lib/mcp/supabase.ts` for the branch Task 6 selected**

**Branch A — Task 6 Step 5 returned rows (RLS works; preferred):**

```typescript
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";
import type { McpAuthContext } from "./auth";

/**
 * A client carrying the caller's own token, so existing RLS policies are the
 * single enforcement point. No user_id filter is applied in application code —
 * `auth.uid() = user_id` does the work.
 */
export function createUserClient(ctx: McpAuthContext): SupabaseClient {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");

  return createClient(SUPABASE_URL, anon, {
    global: { headers: { Authorization: `Bearer ${ctx.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

**Branch B — Task 6 Step 5 returned no rows (RLS does not apply):**

```typescript
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";
import type { McpAuthContext } from "./auth";

/**
 * RLS does not apply to OAuth-server-issued tokens (verified Task 6), so this
 * uses the service role and every caller MUST filter by ctx.userId explicitly.
 * The service key bypasses RLS — a query here without .eq("user_id", …) leaks
 * every user's data.
 */
export function createUserClient(_ctx: McpAuthContext): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

Branch B additionally requires adding `SUPABASE_SERVICE_ROLE_KEY` to Vercel's
environment variables and to `.env.local.example` (name only, no value).

- [ ] **Step 2: If Task 6 showed `aud` is the MCP resource URL, add the audience check**

Only if Open Question 3 resolved positively. In `lib/mcp/auth.ts`, change the
`jwtVerify` options and import `MCP_RESOURCE_URL` from `./config`:

```typescript
      ({ payload } = await jwtVerify(token, keySet, {
        issuer,
        audience: MCP_RESOURCE_URL,
      }));
```

Then add this test to `lib/mcp/auth.test.ts`:

```typescript
  it("rejects a token issued for a different resource", async () => {
    const { privateKey, keySet } = await makeKeys();
    const verify = createTokenVerifier(keySet, ISSUER, "https://good.example/api/mcp");
    const token = await new SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience("https://evil.example/api/mcp")
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verify(token)).rejects.toBeInstanceOf(McpAuthError);
  });
```

This requires `createTokenVerifier` to take a third `audience` parameter; add it
with a default of `MCP_RESOURCE_URL` and thread it into the `jwtVerify` options.
Update the five existing tests to call `.setAudience("https://good.example/api/mcp")`
and pass the same audience to `createTokenVerifier`.

If Open Question 3 resolved negatively, skip this step entirely and leave a comment
in `lib/mcp/auth.ts` recording that audience binding is unavailable, referencing
the spec.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/
git commit -m "feat(mcp): add user-scoped Supabase client"
```

---

### Task 8: Protected resource metadata

This document is what a 401 points at, and it is how Claude discovers which
authorization server to use.

**Files:**
- Create: `app/.well-known/oauth-protected-resource/api/mcp/route.ts`
- Possibly modify: `next.config.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { MCP_ISSUER, MCP_RESOURCE_URL } from "@/lib/mcp/config";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    {
      resource: MCP_RESOURCE_URL,
      authorization_servers: [MCP_ISSUER],
      scopes_supported: ["openid", "email", "offline_access"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
```

- [ ] **Step 2: Verify the dot-directory route resolves (Open Question 1)**

Run: `npm run dev`, then in another shell:

```bash
curl -sS -i "http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"
```

Expected: HTTP 200 with the JSON body above.

**If it 404s**, Next.js is not serving the dot-prefixed directory. Move the file to
`app/api/well-known/oauth-protected-resource/route.ts` and add a rewrite to
`next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource/api/mcp",
        destination: "/api/well-known/oauth-protected-resource",
      },
    ];
  },
};

export default nextConfig;
```

Merge this into the existing config rather than replacing it. Re-run the curl and
confirm 200 before continuing.

- [ ] **Step 3: Record which path worked in the spec**

Update Open Question 1 with the answer and the date, then commit alongside the code.

- [ ] **Step 4: Commit**

```bash
git add app/ next.config.ts docs/superpowers/specs/2026-08-14-mcp-connector-design.md
git commit -m "feat(mcp): serve RFC 9728 protected resource metadata"
```

---

### Task 9: MCP endpoint with the first tool

**Files:**
- Create: `lib/mcp/tools.ts`
- Create: `app/api/mcp/route.ts`

- [ ] **Step 1: Read the installed `mcp-handler` API surface**

Run:

```bash
cat node_modules/mcp-handler/README.md | head -120
ls node_modules/mcp-handler/dist/*.d.ts && cat node_modules/mcp-handler/dist/index.d.ts
```

Confirm the exported names and signatures of `createMcpHandler` and `withMcpAuth`,
and how a tool is registered on the server instance. **Write Step 3 against what
these files show, not against the sketch below** — the sketch reflects documented
2.x behaviour but the exact parameter shapes have not been verified against the
installed package.

- [ ] **Step 2: Write `lib/mcp/tools.ts` with `list_portfolios`**

```typescript
import "server-only";
import { z } from "zod";
import type { McpAuthContext } from "./auth";
import { createUserClient } from "./supabase";

export const NO_PORTFOLIOS_MESSAGE =
  "This account has no portfolios yet. Upload a portfolio screenshot at " +
  "https://port-pulse-seven.vercel.app to create one.";

export type PortfolioSummary = {
  id: string;
  name: string;
  holdings_count: number;
};

export async function listPortfolios(
  ctx: McpAuthContext,
): Promise<PortfolioSummary[] | { message: string }> {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("portfolios")
    .select("id, name, watchlist_items(count)")
    .eq("user_id", ctx.userId)
    .order("position", { ascending: true });

  if (error) throw new Error(`Failed to load portfolios: ${error.message}`);
  if (!data || data.length === 0) return { message: NO_PORTFOLIOS_MESSAGE };

  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    holdings_count:
      (row.watchlist_items as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export const listPortfoliosSchema = z.object({});
```

The explicit `.eq("user_id", ctx.userId)` is correct under both Task 7 branches: it
is redundant under RLS and load-bearing under service role. Keeping it makes the
tool safe regardless of which branch shipped.

- [ ] **Step 3: Write `app/api/mcp/route.ts`**

Using the API confirmed in Step 1. Expected shape:

```typescript
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { MCP_RESOURCE_URL, PORTPULSE_ORIGIN } from "@/lib/mcp/config";
import { McpAuthError, verifyToken } from "@/lib/mcp/auth";
import { listPortfolios, listPortfoliosSchema } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler((server) => {
  server.tool(
    "list_portfolios",
    "List the signed-in user's Port Pulse portfolios with a holdings count.",
    listPortfoliosSchema.shape,
    async (_args, extra) => {
      const result = await listPortfolios(extra.authInfo as never);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
});

const authenticated = withMcpAuth(
  handler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    try {
      return await verifyToken(bearer);
    } catch (err) {
      if (err instanceof McpAuthError) return undefined;
      throw err;
    }
  },
  {
    required: true,
    resourceMetadataPath: `${PORTPULSE_ORIGIN}/.well-known/oauth-protected-resource/api/mcp`,
  },
);

export { authenticated as GET, authenticated as POST, authenticated as DELETE };
```

Adjust names and option keys to match Step 1's findings. The invariants that must
hold regardless of API shape: an absent or invalid token produces a 401 carrying a
`WWW-Authenticate` header referencing the metadata URL from Task 8; a valid token
reaches the tool handler with the verified `userId`.

- [ ] **Step 4: Verify the 401 challenge**

Run `npm run dev`, then:

```bash
curl -sS -i -X POST "http://localhost:3000/api/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: HTTP 401 with a `WWW-Authenticate: Bearer …resource_metadata="…"` header.
This header is the discovery mechanism — if it is missing, Claude cannot start the
OAuth flow, and no later task will fix it.

- [ ] **Step 5: Verify an authenticated call with the Task 6 token**

```bash
curl -sS -X POST "http://localhost:3000/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN from Task 6>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: a JSON-RPC result listing `list_portfolios`. If the token has expired,
repeat Task 6 steps 2–3 to mint a fresh one.

- [ ] **Step 6: Verify with MCP Inspector against the deployed URL**

Deploy, then:

```bash
npx @modelcontextprotocol/inspector
```

Connect to `https://port-pulse-seven.vercel.app/api/mcp`. Expected: the Inspector
walks OAuth discovery, sends you through Google sign-in and `/oauth/consent`, then
lists `list_portfolios`. Call it and confirm your real portfolio names come back.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add authenticated MCP endpoint with list_portfolios"
```

---

### Task 10: Holdings math

Pure functions, no I/O. This is where money numbers are decided, so it is tested
directly rather than through a tool.

**Files:**
- Create: `lib/mcp/types.ts`
- Create: `lib/mcp/portfolio.ts`
- Test: `lib/mcp/portfolio.test.ts`

- [ ] **Step 1: Write `lib/mcp/types.ts`**

```typescript
export type HoldingRow = {
  symbol: string;
  name: string;
  quantity: number | null;
  entry_price: number | null;
};

export type McpHolding = HoldingRow & {
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  weight_pct: number | null;
};

export type McpPortfolioDetail = {
  holdings: McpHolding[];
  totals: {
    market_value: number;
    cost_basis: number | null;
    unrealized_pnl: number | null;
  };
  missing_symbols: string[];
};
```

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { buildPortfolioDetail } from "./portfolio";
import type { HoldingRow } from "./types";

const rows: HoldingRow[] = [
  { symbol: "AAPL", name: "Apple Inc.", quantity: 10, entry_price: 100 },
  { symbol: "MSFT", name: "Microsoft", quantity: 5, entry_price: 200 },
];

describe("buildPortfolioDetail", () => {
  it("computes market value, P&L and weights", () => {
    const result = buildPortfolioDetail(
      rows,
      new Map([
        ["AAPL", 150],
        ["MSFT", 300],
      ]),
    );

    expect(result.totals.market_value).toBe(3000);
    expect(result.totals.cost_basis).toBe(2000);
    expect(result.totals.unrealized_pnl).toBe(1000);

    const aapl = result.holdings[0];
    expect(aapl.market_value).toBe(1500);
    expect(aapl.unrealized_pnl).toBe(500);
    expect(aapl.unrealized_pnl_pct).toBe(50);
    expect(aapl.weight_pct).toBe(50);

    expect(result.missing_symbols).toEqual([]);
  });

  it("reports symbols with no price and excludes them from weights", () => {
    const result = buildPortfolioDetail(rows, new Map([["AAPL", 150]]));

    expect(result.missing_symbols).toEqual(["MSFT"]);
    expect(result.holdings[1].current_price).toBeNull();
    expect(result.holdings[1].market_value).toBeNull();
    expect(result.holdings[1].weight_pct).toBeNull();
    expect(result.holdings[0].weight_pct).toBe(100);
    expect(result.totals.market_value).toBe(1500);
  });

  it("returns null P&L when entry price is unknown", () => {
    const result = buildPortfolioDetail(
      [{ symbol: "AAPL", name: "Apple Inc.", quantity: 10, entry_price: null }],
      new Map([["AAPL", 150]]),
    );

    expect(result.holdings[0].market_value).toBe(1500);
    expect(result.holdings[0].unrealized_pnl).toBeNull();
    expect(result.holdings[0].unrealized_pnl_pct).toBeNull();
    expect(result.totals.cost_basis).toBeNull();
    expect(result.totals.unrealized_pnl).toBeNull();
  });

  it("returns null weights rather than NaN when total value is zero", () => {
    const result = buildPortfolioDetail(
      [{ symbol: "AAPL", name: "Apple Inc.", quantity: null, entry_price: null }],
      new Map(),
    );

    expect(result.totals.market_value).toBe(0);
    expect(result.holdings[0].weight_pct).toBeNull();
    expect(Number.isNaN(result.holdings[0].weight_pct ?? 0)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/mcp/portfolio.test.ts`
Expected: FAIL — cannot resolve `./portfolio`.

- [ ] **Step 4: Write `lib/mcp/portfolio.ts`**

```typescript
import type { HoldingRow, McpHolding, McpPortfolioDetail } from "./types";

export function buildPortfolioDetail(
  rows: HoldingRow[],
  prices: Map<string, number>,
): McpPortfolioDetail {
  const missing_symbols: string[] = [];

  const priced = rows.map((row) => {
    const price = prices.get(row.symbol) ?? null;
    if (price === null) missing_symbols.push(row.symbol);

    const market_value =
      price !== null && row.quantity !== null ? price * row.quantity : null;
    const cost =
      row.entry_price !== null && row.quantity !== null
        ? row.entry_price * row.quantity
        : null;
    const unrealized_pnl =
      market_value !== null && cost !== null ? market_value - cost : null;
    const unrealized_pnl_pct =
      unrealized_pnl !== null && cost !== null && cost !== 0
        ? (unrealized_pnl / cost) * 100
        : null;

    return { row, price, market_value, cost, unrealized_pnl, unrealized_pnl_pct };
  });

  const total_market_value = priced.reduce(
    (sum, p) => sum + (p.market_value ?? 0),
    0,
  );

  const allCostKnown = priced.every((p) => p.cost !== null);
  const cost_basis = allCostKnown
    ? priced.reduce((sum, p) => sum + (p.cost ?? 0), 0)
    : null;
  const unrealized_pnl =
    cost_basis !== null ? total_market_value - cost_basis : null;

  const holdings: McpHolding[] = priced.map((p) => ({
    ...p.row,
    current_price: p.price,
    market_value: p.market_value,
    unrealized_pnl: p.unrealized_pnl,
    unrealized_pnl_pct: p.unrealized_pnl_pct,
    weight_pct:
      p.market_value !== null && total_market_value > 0
        ? (p.market_value / total_market_value) * 100
        : null,
  }));

  return {
    holdings,
    totals: { market_value: total_market_value, cost_basis, unrealized_pnl },
    missing_symbols,
  };
}
```

`cost_basis` is null unless *every* holding has a known entry price — a partial
total would read as a real cost basis and make the P&L figure wrong rather than
absent.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/mcp/portfolio.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp/types.ts lib/mcp/portfolio.ts lib/mcp/portfolio.test.ts
git commit -m "feat(mcp): compute holdings market value, P&L and weights"
```

---

### Task 11: Quote fetching

**Files:**
- Create: `lib/mcp/quotes.ts`

- [ ] **Step 1: Write `lib/mcp/quotes.ts`**

```typescript
import "server-only";
import { fetchYahooChart } from "@/lib/yahoo";

/**
 * Latest close per symbol. Symbols that fail are simply absent from the map;
 * callers surface them as missing rather than substituting a zero, which would
 * silently corrupt weights and totals.
 */
export async function fetchCurrentPrices(
  symbols: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(symbols)];

  const settled = await Promise.allSettled(
    unique.map(async (symbol) => {
      const chart = await fetchYahooChart(symbol, "1D");
      const last = chart.points.at(-1);
      if (!last || !Number.isFinite(last.value) || last.value <= 0) {
        throw new Error(`No usable price for ${symbol}`);
      }
      return [symbol, last.value] as const;
    }),
  );

  const prices = new Map<string, number>();
  for (const result of settled) {
    if (result.status === "fulfilled") {
      prices.set(result.value[0], result.value[1]);
    }
  }
  return prices;
}
```

`Promise.allSettled` rather than `Promise.all` is deliberate: one delisted or
rate-limited symbol must not fail the whole portfolio.

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/mcp/quotes.ts
git commit -m "feat(mcp): fetch current prices with per-symbol failure isolation"
```

---

### Task 12: `get_portfolio` tool

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `app/api/mcp/route.ts`

- [ ] **Step 1: Add the handler to `lib/mcp/tools.ts`**

```typescript
import { z } from "zod";
import { buildPortfolioDetail } from "./portfolio";
import { fetchCurrentPrices } from "./quotes";
import type { HoldingRow, McpPortfolioDetail } from "./types";

export const getPortfolioSchema = z.object({
  portfolio_id: z.string().uuid().optional(),
  name: z.string().min(1).max(80).optional(),
});

export async function getPortfolio(
  ctx: McpAuthContext,
  args: { portfolio_id?: string; name?: string },
): Promise<(McpPortfolioDetail & { id: string; name: string }) | { message: string }> {
  const supabase = createUserClient(ctx);

  const { data: portfolios, error: pErr } = await supabase
    .from("portfolios")
    .select("id, name")
    .eq("user_id", ctx.userId);

  if (pErr) throw new Error(`Failed to load portfolios: ${pErr.message}`);
  if (!portfolios || portfolios.length === 0) {
    return { message: NO_PORTFOLIOS_MESSAGE };
  }

  let match: { id: string; name: string } | undefined;
  if (args.portfolio_id) {
    match = portfolios.find((p) => p.id === args.portfolio_id);
  } else if (args.name) {
    const wanted = args.name.trim().toLowerCase();
    const hits = portfolios.filter((p) => p.name.toLowerCase() === wanted);
    if (hits.length > 1) {
      throw new Error(
        `More than one portfolio is named "${args.name}". Use portfolio_id instead. ` +
          `Ids: ${hits.map((h) => h.id).join(", ")}`,
      );
    }
    match = hits[0];
  } else {
    throw new Error("Provide either portfolio_id or name.");
  }

  if (!match) {
    throw new Error(
      `No such portfolio. Available: ${portfolios.map((p) => p.name).join(", ")}`,
    );
  }

  const { data: items, error: iErr } = await supabase
    .from("watchlist_items")
    .select("symbol, name, quantity, entry_price")
    .eq("portfolio_id", match.id)
    .eq("user_id", ctx.userId);

  if (iErr) throw new Error(`Failed to load holdings: ${iErr.message}`);

  const rows: HoldingRow[] = (items ?? []).map((i) => ({
    symbol: i.symbol as string,
    name: (i.name as string) ?? "",
    quantity: (i.quantity as number | null) ?? null,
    entry_price: (i.entry_price as number | null) ?? null,
  }));

  const prices = await fetchCurrentPrices(rows.map((r) => r.symbol));
  if (rows.length > 0 && prices.size === 0) {
    throw new Error(
      "Price data is unavailable upstream right now. Try again shortly.",
    );
  }

  return { id: match.id, name: match.name, ...buildPortfolioDetail(rows, prices) };
}
```

`portfolio_id` wins when both are supplied, matching the spec. A total upstream
price failure is an error rather than a zero-priced portfolio.

- [ ] **Step 2: Register the tool in `app/api/mcp/route.ts`**

Inside the `createMcpHandler` callback, after `list_portfolios`:

```typescript
  server.tool(
    "get_portfolio",
    "Get one portfolio's holdings with current prices, unrealized P&L and weights. " +
      "Identify it by portfolio_id, or by name if you already listed portfolios.",
    getPortfolioSchema.shape,
    async (args, extra) => {
      const result = await getPortfolio(extra.authInfo as never, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
```

Add `getPortfolio, getPortfolioSchema` to the existing import from `@/lib/mcp/tools`.

- [ ] **Step 3: Verify with the Inspector**

Deploy, reconnect the Inspector, call `get_portfolio` with a real portfolio name.
Expected: holdings with prices, and `weight_pct` values summing to ~100.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/tools.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add get_portfolio tool"
```

---

### Task 13: `get_position` tool

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `app/api/mcp/route.ts`

- [ ] **Step 1: Add the handler to `lib/mcp/tools.ts`**

```typescript
import { SYMBOL_RE } from "./config";

export const getPositionSchema = z.object({
  symbol: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => SYMBOL_RE.test(s), "Not a valid ticker symbol"),
});

export async function getPosition(ctx: McpAuthContext, args: { symbol: string }) {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("quantity, entry_price, portfolios(id, name)")
    .eq("user_id", ctx.userId)
    .eq("symbol", args.symbol);

  if (error) throw new Error(`Failed to load position: ${error.message}`);
  if (!data || data.length === 0) {
    return { message: `${args.symbol} is not held in any portfolio.` };
  }

  const prices = await fetchCurrentPrices([args.symbol]);
  const current_price = prices.get(args.symbol) ?? null;

  const portfolios = data.map((row) => {
    const p = row.portfolios as unknown as { id: string; name: string } | null;
    return {
      portfolio_id: p?.id ?? null,
      portfolio_name: p?.name ?? null,
      quantity: (row.quantity as number | null) ?? null,
      entry_price: (row.entry_price as number | null) ?? null,
    };
  });

  const total_quantity = portfolios.reduce((s, p) => s + (p.quantity ?? 0), 0);
  const allCostKnown = portfolios.every(
    (p) => p.quantity !== null && p.entry_price !== null,
  );
  const cost_basis = allCostKnown
    ? portfolios.reduce((s, p) => s + p.quantity! * p.entry_price!, 0)
    : null;

  return {
    symbol: args.symbol,
    current_price,
    total_quantity,
    cost_basis,
    market_value: current_price !== null ? current_price * total_quantity : null,
    portfolios,
  };
}
```

- [ ] **Step 2: Register the tool in `app/api/mcp/route.ts`**

```typescript
  server.tool(
    "get_position",
    "Get the user's total exposure to one ticker, aggregated across every portfolio.",
    getPositionSchema.shape,
    async (args, extra) => {
      const result = await getPosition(extra.authInfo as never, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
```

- [ ] **Step 3: Verify with the Inspector**

Call `get_position` with a ticker you hold in two portfolios. Expected: both rows,
with `total_quantity` equal to their sum.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/tools.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add get_position tool"
```

---

### Task 14: `get_price_history` tool

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `app/api/mcp/route.ts`

- [ ] **Step 1: Add the handler to `lib/mcp/tools.ts`**

```typescript
import { fetchYahooChart, YahooFetchError } from "@/lib/yahoo";
import { HISTORY_RANGES } from "@/lib/history";
import type { HistoryRange } from "@/types";

export const getPriceHistorySchema = z.object({
  symbol: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => SYMBOL_RE.test(s), "Not a valid ticker symbol"),
  range: z.enum(HISTORY_RANGES as unknown as [HistoryRange, ...HistoryRange[]]),
});

export async function getPriceHistory(
  _ctx: McpAuthContext,
  args: { symbol: string; range: HistoryRange },
) {
  try {
    return await fetchYahooChart(args.symbol, args.range);
  } catch (err) {
    if (err instanceof YahooFetchError) {
      throw new Error(`Price history unavailable: ${err.message}`);
    }
    throw err;
  }
}
```

Only `HISTORY_RANGES` and the `HistoryRange` type are imported from
`@/lib/history` — **not** `fetchHistory`, which is client-side and issues a relative
fetch that cannot resolve on the server.

- [ ] **Step 2: Register the tool in `app/api/mcp/route.ts`**

```typescript
  server.tool(
    "get_price_history",
    "Get a price history series for one ticker over 1D, 1M, 3M, YTD, 1Y or 5Y.",
    getPriceHistorySchema.shape,
    async (args, extra) => {
      const result = await getPriceHistory(extra.authInfo as never, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
```

- [ ] **Step 3: Verify with the Inspector**

Call `get_price_history` with `{ "symbol": "AAPL", "range": "1M" }`.
Expected: a `points` array of `{ time, value }` objects.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/tools.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add get_price_history tool"
```

---

### Task 15: `get_risk_metrics` tool

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `app/api/mcp/route.ts`

- [ ] **Step 1: Read the existing risk route to reuse its logic exactly**

Run: `cat app/api/risk/route.ts`

The tool must produce the same numbers as the in-app risk panel. Reuse the same
benchmark (`SPY`), the same 1Y window, the same `MIN_DAYS` guard, and the same
`alignByTime` / `dailyReturns` / `sharpeRatio` / `beta` / `annualizedVolatility` /
`maxDrawdown` calls from `@/lib/riskMetrics`. If that route has helper functions
worth sharing, extract them into `lib/mcp/risk.ts` and have **both** the route and
the tool import them, rather than copying the logic — two implementations of the
same metric will drift and report different numbers for the same portfolio.

- [ ] **Step 2: Add the handler to `lib/mcp/tools.ts`**

```typescript
export const getRiskMetricsSchema = z.object({
  portfolio_id: z.string().uuid(),
});

export async function getRiskMetrics(
  ctx: McpAuthContext,
  args: { portfolio_id: string },
) {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("symbol, quantity")
    .eq("portfolio_id", args.portfolio_id)
    .eq("user_id", ctx.userId);

  if (error) throw new Error(`Failed to load holdings: ${error.message}`);

  const holdings = (data ?? [])
    .map((r) => ({
      symbol: r.symbol as string,
      quantity: (r.quantity as number | null) ?? 0,
    }))
    .filter((h) => h.quantity > 0)
    .slice(0, MAX_SYMBOLS);

  if (holdings.length === 0) {
    return {
      message:
        "Risk metrics need holdings with a quantity. This portfolio has none recorded.",
    };
  }

  return computePortfolioRisk(holdings);
}
```

`computePortfolioRisk` is the shared function extracted in Step 1. Import
`MAX_SYMBOLS` from `./config`.

- [ ] **Step 3: Register the tool in `app/api/mcp/route.ts`**

```typescript
  server.tool(
    "get_risk_metrics",
    "Get Sharpe ratio, beta, annualized volatility and max drawdown for a " +
      "portfolio over the last year, benchmarked against SPY.",
    getRiskMetricsSchema.shape,
    async (args, extra) => {
      const result = await getRiskMetrics(extra.authInfo as never, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
```

- [ ] **Step 4: Verify the numbers match the app**

Open the risk panel in the app for a portfolio, then call `get_risk_metrics` for
the same `portfolio_id` in the Inspector. Expected: identical Sharpe, beta,
volatility and max drawdown. A mismatch means the logic was copied rather than
shared — go back to Step 1.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/ app/api/mcp/route.ts app/api/risk/route.ts
git commit -m "feat(mcp): add get_risk_metrics tool sharing logic with the risk route"
```

---

### Task 16: `get_sector_breakdown` tool

**Files:**
- Modify: `lib/mcp/tools.ts`
- Modify: `app/api/mcp/route.ts`

- [ ] **Step 1: Check how sector data is stored**

Run: `head -40 lib/sectorMap.ts && cat app/api/sectors/route.ts`

`lib/sectors.ts` exports React hooks only and must not be imported here. Use the
map in `lib/sectorMap.ts` directly, matching whatever lookup shape the sectors route
uses.

- [ ] **Step 2: Add the handler to `lib/mcp/tools.ts`**

```typescript
export const getSectorBreakdownSchema = z.object({
  portfolio_id: z.string().uuid(),
});

export async function getSectorBreakdown(
  ctx: McpAuthContext,
  args: { portfolio_id: string },
) {
  const supabase = createUserClient(ctx);

  const { data, error } = await supabase
    .from("watchlist_items")
    .select("symbol, quantity")
    .eq("portfolio_id", args.portfolio_id)
    .eq("user_id", ctx.userId);

  if (error) throw new Error(`Failed to load holdings: ${error.message}`);

  const rows = (data ?? [])
    .map((r) => ({
      symbol: r.symbol as string,
      quantity: (r.quantity as number | null) ?? 0,
    }))
    .filter((h) => h.quantity > 0);

  if (rows.length === 0) {
    return {
      message:
        "A sector breakdown needs holdings with a quantity. This portfolio has none recorded.",
    };
  }

  const prices = await fetchCurrentPrices(rows.map((r) => r.symbol));

  const byName = new Map<string, { value: number; symbols: string[] }>();
  let total = 0;
  const missing_symbols: string[] = [];

  for (const row of rows) {
    const price = prices.get(row.symbol);
    if (price === undefined) {
      missing_symbols.push(row.symbol);
      continue;
    }
    const value = price * row.quantity;
    total += value;

    const sector = lookupSector(row.symbol) ?? "Unknown";
    const entry = byName.get(sector) ?? { value: 0, symbols: [] };
    entry.value += value;
    entry.symbols.push(row.symbol);
    byName.set(sector, entry);
  }

  const sectors = [...byName.entries()]
    .map(([sector, e]) => ({
      sector,
      value: e.value,
      percent: total > 0 ? (e.value / total) * 100 : 0,
      symbols: e.symbols,
    }))
    .sort((a, b) => b.value - a.value);

  return { sectors, total_value: total, missing_symbols };
}
```

`lookupSector` is whatever synchronous lookup Step 1 identified in
`lib/sectorMap.ts`; import it by its real name.

- [ ] **Step 2b: Register the tool in `app/api/mcp/route.ts`**

```typescript
  server.tool(
    "get_sector_breakdown",
    "Break a portfolio down by sector, with value, percentage and constituent tickers.",
    getSectorBreakdownSchema.shape,
    async (args, extra) => {
      const result = await getSectorBreakdown(extra.authInfo as never, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );
```

- [ ] **Step 3: Verify against the app**

Compare the Inspector output with the app's sector breakdown panel for the same
portfolio. Percentages should match.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp/tools.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add get_sector_breakdown tool"
```

---

### Task 17: Enable DCR and connect from claude.ai

- [ ] **Step 1: Merge and deploy to production**

The connector must be on the production domain, since that is the Site URL Supabase
redirects to.

```bash
git checkout main && git merge --no-ff feat/mcp-connector && git push
```

- [ ] **Step 2: Enable dynamic client registration**

Supabase dashboard → Authentication → OAuth Server → enable "Allow Dynamic OAuth
Apps" → Save changes.

- [ ] **Step 3: Confirm a registration endpoint appeared**

```bash
curl -sS "https://kbbgyyiasbvgmfoxoeaz.supabase.co/.well-known/oauth-authorization-server/auth/v1" \
  | python3 -m json.tool | grep -i registration
```

Expected: a `registration_endpoint` entry.

**If absent**, one-click connect is not available. Fall back to registering a client
manually (as in Task 6) and entering its client ID and secret under **Advanced
settings** when adding the connector in Claude. Record which path was used in the
spec.

- [ ] **Step 4: Add the connector in Claude**

Settings → Connectors → Add custom connector →
`https://port-pulse-seven.vercel.app/api/mcp`. Complete Google sign-in and approve
on the consent screen.

- [ ] **Step 5: Verify end to end**

Ask Claude: *"What's in my portfolios, and how concentrated am I?"*

Expected: it calls `list_portfolios`, then `get_portfolio` and/or
`get_sector_breakdown`, and answers with your real holdings. Spot-check two
positions against the dashboard.

- [ ] **Step 6: Verify cross-user isolation**

With a second Google account, sign in to Port Pulse, create a portfolio, and mint a
token for that user (Task 6 steps 2–3). Call `list_portfolios` with it.

Expected: only the second user's portfolio. Seeing the first user's data is a
critical failure — stop and fix before going further. This is the single most
important check in the plan, and it is the one that catches a missing `user_id`
filter under the Task 7 service-role branch.

- [ ] **Step 7: Commit any spec updates**

```bash
git add docs/superpowers/specs/2026-08-14-mcp-connector-design.md
git commit -m "docs: record DCR outcome and end-to-end verification"
```

---

### Task 18: Security review

- [ ] **Step 1: Run the project's security review skill**

This work touches auth, adds a public unauthenticated-by-default endpoint, and
reads user data — all three triggers named in `CLAUDE.md`.

Run the `security-review` skill over the diff between `main` and the merge base.

- [ ] **Step 2: Confirm each of these explicitly**

- A request with no bearer token returns 401 with a `WWW-Authenticate` header.
- A token signed by any other key is rejected.
- A token from a different issuer is rejected.
- An expired token is rejected.
- No tool can be reached without a verified `userId`.
- Every Supabase query filters on `user_id` (mandatory under the service-role
  branch, defence in depth under RLS).
- No secret is logged. Check for `console.log` of tokens in `lib/mcp/`.
- `SUPABASE_SERVICE_ROLE_KEY`, if introduced by Task 7 branch B, is server-only and
  absent from any `NEXT_PUBLIC_` variable.

- [ ] **Step 3: Fix findings and commit**

```bash
git add -A
git commit -m "fix(mcp): address security review findings"
```

- [ ] **Step 4: Run the full verification suite**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all pass.

---

## Deferred, deliberately

- **Write tools** (`add_ticker`, `remove_ticker`, portfolio CRUD). Blocked on spec
  Open Question 3: without audience-bound tokens, a token issued to another OAuth
  client is accepted here, and that is tolerable only while every tool is read-only.
- **An in-app "Connect to Claude" button.** Nice, not needed — the connector is
  added from Claude's side.
- **Per-user connector revocation UI.** Supabase's dashboard can revoke OAuth apps
  in the meantime.
