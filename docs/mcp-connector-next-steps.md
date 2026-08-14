# MCP Connector — Next Steps (session handoff)

**Updated:** 2026-08-14
**Status:** 17 of 18 tasks done. All code is written, tested and committed on
`feat/mcp-tools`. **Task 17 is the only one left, and it is the owner's.**

Authoritative background, if you need it:

- `docs/superpowers/specs/2026-08-14-mcp-connector-design.md`
- `docs/superpowers/plans/2026-08-14-mcp-connector.md`

---

## Where things stand

The connector is **built but not yet connectable**, because dynamic client
registration is still off and the branch is not merged to production. Both are
Task 17, below.

### What now exists

| File | What it does |
|---|---|
| `lib/mcp/config.ts` | issuer, JWKS URL, origin, resource URL, symbol caps |
| `lib/mcp/auth.ts` | bearer JWT → verified context; `toAuthInfo` / `authContextFrom` |
| `lib/mcp/supabase.ts` | user-scoped client carrying the caller's token |
| `lib/mcp/tools.ts` | all six tool handlers |
| `lib/mcp/portfolio.ts` | market value, P&L, weights (pure, tested) |
| `lib/mcp/quotes.ts` | current prices, per-symbol failure isolation |
| `lib/mcp/risk.ts` | risk metrics, **shared with `app/api/risk/route.ts`** |
| `lib/mcp/types.ts` | holding and portfolio-detail types |
| `app/api/mcp/route.ts` | the MCP endpoint, all six tools registered |
| `app/.well-known/oauth-protected-resource/api/mcp/route.ts` | RFC 9728 metadata |

All six tools are live: `list_portfolios`, `get_portfolio`, `get_position`,
`get_price_history`, `get_risk_metrics`, `get_sector_breakdown`.

### Verification status

`npm test` 35 passing · `npx tsc --noEmit` clean · `npm run lint` clean ·
`npm run build` clean.

Verified against a running server: the metadata document returns 200, an
unauthenticated POST to `/api/mcp` returns 401 with a well-formed
`WWW-Authenticate: … resource_metadata="…"` header, and the refactored risk
route still returns real metrics (251 sample days, beta vs SPY) and still 400s
on empty holdings.

**Not yet verified with a real token.** The probe client was deleted at the end
of Task 6, so no live token existed during the build. The authenticated path is
covered by `lib/mcp/endpoint.test.ts`, which drives the real handler through
challenge → rejection → `tools/list` → `tools/call` and asserts the token's
`sub` reaches the Supabase client. First real-token exercise is Task 17 Step 5.

---

## Where the plan was wrong

The plan's Task 9 sketch was written against an older `mcp-handler`. Four things
differ from the installed packages (`mcp-handler@2.1.1`,
`@modelcontextprotocol/server@2.0.0`). If you are reading the plan, read these
corrections alongside it:

1. **`server.tool()` does not exist.** Use
   `server.registerTool(name, { description, inputSchema }, cb)`.
2. **Auth arrives at `ctx.http?.authInfo`**, not `extra.authInfo`. The plan's
   version would have silently passed `undefined` into every tool.
3. **The `withMcpAuth` verifier must return an SDK `AuthInfo`**, not a custom
   context. `userId` travels in `AuthInfo.extra` and comes back out through
   `authContextFrom`.
4. **`resourceMetadataPath` is a path, not a URL.** It is concatenated onto an
   origin, so passing a full URL produces `https://hosthttps://host/…` and
   breaks discovery.

`lib/mcp/endpoint.test.ts` exists specifically to pin all four.

---

## Task 17 — the remaining work, and it is yours

### Step 1 — merge and deploy

The connector must be on the production domain, since that is the Site URL
Supabase redirects to.

```bash
cd ~/Projects/personal/port-pulse
git checkout main
git merge --no-ff feat/mcp-tools
git push
```

Wait for the Vercel deploy to finish, then confirm both endpoints are live:

```bash
curl -sS -o /dev/null -w "metadata: %{http_code}\n" \
  https://port-pulse-seven.vercel.app/.well-known/oauth-protected-resource/api/mcp
curl -sS -o /dev/null -w "mcp (expect 401): %{http_code}\n" -X POST \
  https://port-pulse-seven.vercel.app/api/mcp
```

Expected: `200` and `401`. A 404 on either means the deploy has not landed yet.

### Step 2 — enable dynamic client registration

Supabase dashboard → **Authentication → OAuth Server** → enable
**"Allow Dynamic OAuth Apps"** → Save.

This is what makes one-click connect work. It was deliberately left off until
now so no client could register against a half-built endpoint.

### Step 3 — confirm the registration endpoint appeared

```bash
curl -sS "https://kbbgyyiasbvgmfoxoeaz.supabase.co/.well-known/oauth-authorization-server/auth/v1" \
  | python3 -m json.tool | grep -i registration
```

Expected: a `registration_endpoint` entry.

**If it is absent**, one-click connect is unavailable. Fall back to registering
a client by hand (as in Task 6) and entering its client ID and secret under
**Advanced settings** when adding the connector.

### Step 4 — add the connector in Claude

Settings → Connectors → Add custom connector →
`https://port-pulse-seven.vercel.app/api/mcp`

Complete Google sign-in and approve on the consent screen. The consent page
should now show **Claude's** client name rather than `MCP Probe`.

### Step 5 — verify end to end

Ask Claude: *"What's in my portfolios, and how concentrated am I?"*

Expected: it calls `list_portfolios`, then `get_portfolio` and/or
`get_sector_breakdown`, and answers with your real holdings. Spot-check two
positions against the dashboard.

Also worth asking, since it exercises the shared risk code:
*"What's the Sharpe ratio and beta on my main portfolio?"* — the numbers must
match the in-app risk panel exactly. They call the same function, so a mismatch
would mean something is wrong with which portfolio was selected, not with the
maths.

### Step 6 — verify cross-user isolation ⚠️

**This is the most important check in the whole plan.** With a second Google
account, sign in to Port Pulse, create a portfolio, mint a token for that user,
and call `list_portfolios` with it.

Expected: only the second user's portfolio. Seeing the first user's data is a
critical failure — stop and fix before using the connector.

Under the shipped design this is enforced twice over (RLS on the caller's token,
plus an explicit `user_id` filter on all six queries), so it should pass. Check
it anyway.

---

## Known issues carried forward

- **Write tools remain blocked**, and permanently so under the current
  authorization server. Any Supabase token this project issues for the user is
  accepted at `/api/mcp` — including an ordinary web-app session token, not just
  an OAuth-client token. That is tolerable only because every tool is read-only
  and returns exactly the rows RLS already grants that token: a replayed token
  gains no authority it did not already have via PostgREST. The reasoning
  collapses the moment a tool can mutate data. See spec Open Question 3.
- **JWT algorithm is not pinned.** `jwtVerify` does not pass
  `algorithms: ["ES256"]`. Deliberate: jose already rejects `alg: none` and
  enforces key-type/algorithm compatibility, and pinning would break the
  connector outright if Supabase rotates its signing algorithm. Revisit if that
  trade-off ever changes.
- `npm test` exits non-zero when no test files match — relevant only if the
  `include` glob in `vitest.config.ts` changes.
- Vitest emits two harmless warnings: an ESM/CommonJS notice for
  `vitest.config.ts`, and a suggestion to replace `vite-tsconfig-paths` with the
  native `resolve.tsconfigPaths` option.

---

## Deferred, deliberately

- Write tools (`add_ticker`, `remove_ticker`, portfolio CRUD) — blocked as above.
- An in-app "Connect to Claude" button — the connector is added from Claude's side.
- Per-user connector revocation UI — Supabase's dashboard can revoke OAuth apps.
