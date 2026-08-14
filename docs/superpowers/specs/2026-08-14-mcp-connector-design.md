# Port Pulse MCP Connector — Design

**Date:** 2026-08-14
**Status:** Approved, pending implementation plan

## Goal

Let a Port Pulse user connect their claude.ai account to their Port Pulse account
as a custom connector (remote MCP server), so they can ask Claude for analysis and
advice about their real portfolios in ordinary conversation.

Port Pulse stays the single source of truth. Claude reads from it; it never writes.

## Non-goals

- **No writes of any kind.** Claude cannot add or remove tickers, or create,
  rename, or delete portfolios. Read-only is the entire surface.
- **No changes to the in-app experience.** The dashboard, Uploader, and Insights
  drawer behave exactly as they do today.
- **No second identity system.** Users authenticate with the same Google sign-in
  they already use; `watchlist_items.user_id` keeps its current meaning.
- **No local/stdio MCP server.** claude.ai is the target surface, which requires a
  publicly reachable HTTPS endpoint.

## Background

The app today is a Next.js 16 App Router project on Vercel with Supabase for auth
(Google OAuth) and Postgres. Relevant existing state:

- `portfolios` and `watchlist_items` tables, both with RLS scoping rows to
  `auth.uid() = user_id` (`supabase/schema.sql`).
- API routes under `app/api/` — `watchlist`, `portfolios`, `positions/[symbol]`,
  `history`, `risk`, `sectors`, `insights`, `compare`, `parse`.
- `app/api/watchlist/route.ts` and `app/api/portfolios/route.ts` authenticate via
  the **Supabase session cookie** (`createServerSupabase()` → `auth.getUser()`).
- `app/api/risk/route.ts` and `app/api/sectors/route.ts` are stateless
  computation endpoints — they accept tickers in the request body and do not
  authenticate.
- `lib/yahoo.ts` `fetchYahooChart()` is a server-side REST fetch, so quotes and
  history are obtainable without a browser.
- Live in-app prices come from a Finnhub **WebSocket** held open by the browser
  (`lib/finnhub.ts`). This is unusable from a stateless tool call.

Two consequences drive the design:

1. MCP requests arrive with `Authorization: Bearer <jwt>` and **no cookie**, so the
   connector cannot reuse the existing cookie-based auth path. It needs its own
   bearer-token → `user_id` path.
2. The connector's price data must come from the Yahoo REST path
   (`fetchYahooChart`), not Finnhub.

## Architecture

Supabase Auth acts as the OAuth 2.1 authorization server (public beta feature,
shipped Nov 2025, built against the MCP auth spec). The Next.js app acts as the
OAuth resource server and hosts the MCP endpoint. No separate service.

```
claude.ai
   │  ① POST /api/mcp  (no token)
   │  ← 401 + WWW-Authenticate: resource_metadata="…/.well-known/oauth-protected-resource/api/mcp"
   │  ② GET that metadata → authorization server is <project>.supabase.co
   │  ③ GET Supabase AS metadata → authorize / token / register endpoints
   │  ④ Dynamic client registration (Claude registers itself)
   │  ⑤ User → Supabase /authorize → PORTPULSE_ORIGIN/oauth/consent?authorization_id=…
   │       → existing Google sign-in → approve
   │  ⑥ authorization code + PKCE → token endpoint → signed JWT
   │  ⑦ POST /api/mcp  Authorization: Bearer <jwt>
   ▼
Next.js on Vercel
   ├── /.well-known/oauth-protected-resource/api/mcp   RFC 9728 metadata
   ├── /oauth/consent                                  consent UI
   └── /api/mcp                                        MCP Streamable HTTP
          └── withMcpAuth → verify JWT via JWKS → user_id
                 └── tools → Supabase (RLS) + lib/yahoo + lib/riskMetrics
```

Steps ① – ⑥ run once, when the user adds the connector. Steady state is ⑦ only.

### Named inputs

| Name | Value | Source |
|---|---|---|
| `SUPABASE_PROJECT_REF` | `kbbgyyiasbvgmfoxoeaz` | `.env.local` |
| `PORTPULSE_ORIGIN` | *supplied by owner* — see Prerequisites | Vercel production domain |
| MCP resource URL | `${PORTPULSE_ORIGIN}/api/mcp` | derived |
| JWKS URL | `https://${SUPABASE_PROJECT_REF}.supabase.co/auth/v1/.well-known/jwks.json` | derived |

## Components

New files only; no existing file is rewritten.

```
app/api/mcp/route.ts                                        MCP endpoint
app/.well-known/oauth-protected-resource/api/mcp/route.ts   RFC 9728 metadata
app/oauth/consent/page.tsx                                  consent screen
lib/mcp/auth.ts                                             bearer JWT → { userId }
lib/mcp/tools.ts                                            tool definitions
lib/mcp/portfolio.ts                                        holdings + quotes + metrics assembly
```

Possible edit to `next.config.ts` — see Open Question 1.

Dependencies to add: `mcp-handler` (^2), `@modelcontextprotocol/server` (^2),
`jose` (JWKS verification). `zod` ^4.2 is required by `mcp-handler` 2.x and is not
currently a dependency.

### Consent screen

Supabase does not host a consent UI. The page at `/oauth/consent` receives an
`authorization_id` query parameter and must:

1. Confirm the visitor is signed in; if not, run the existing Google sign-in and
   return to this URL.
2. Call `supabase.auth.oauth.getAuthorizationDetails()` to fetch the requesting
   client's name, redirect URI, and requested scopes.
3. Render them, styled to match the app's dark theme.
4. Call `approveAuthorization()` or `denyAuthorization()` on the user's choice.

## Tool surface

Six tools, all read-only.

| Tool | Input | Output | Built on |
|---|---|---|---|
| `list_portfolios` | — | `[{ id, name, holdings_count, market_value }]` | `portfolios`, `watchlist_items` |
| `get_portfolio` | `portfolio_id` \| `name` (id wins if both given; name match is case-insensitive and must be unique, else error listing candidates) | per holding: `symbol, name, quantity, entry_price, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, weight_pct`; plus portfolio totals | `watchlist_items` + `fetchYahooChart` |
| `get_position` | `symbol` | aggregate across all portfolios: total quantity, cost basis, per-portfolio rows | mirrors `app/api/positions/[symbol]` |
| `get_price_history` | `symbol`, `range` (`1D\|1M\|3M\|YTD\|1Y\|5Y`) | `{ symbol, range, interval, currency, points[] }` | `lib/history.ts` `fetchHistory` |
| `get_risk_metrics` | `portfolio_id` | `{ sharpe, beta, volatility, max_drawdown, benchmark, sample_days, missing_symbols? }` | `lib/riskMetrics.ts`, benchmark SPY, 1Y window |
| `get_sector_breakdown` | `portfolio_id` | `[{ sector, value, percent, symbols[] }]` | `lib/sectorMap.ts` |

Claude performs the analysis itself from these outputs.

### Why there is no `get_insights` tool

`app/api/insights/route.ts` calls `streamInsights()`, which calls the Claude API.
Exposing it as a tool would mean Claude calling Claude to analyse data it can
analyse directly — double latency, double cost, and the server-side prompt would
constrain conclusions the user did not ask to constrain. The in-app Insights
drawer is unaffected and keeps using that route.

### Sector data access

`lib/sectors.ts` exports only React hooks (`useSector`, `getSectorSync`,
`useSectorsVersion`) and is client-oriented. `get_sector_breakdown` reads the
underlying map in `lib/sectorMap.ts` directly rather than reusing that module.

### Input limits

Mirror the caps already enforced by `app/api/risk/route.ts`: symbol pattern
`/^[A-Z]{1,5}(\.[A-Z])?$/`, maximum 60 symbols per request. Tool inputs are
validated with zod schemas before any query or fetch runs.

## Authentication and security

### Token verification (`lib/mcp/auth.ts`)

On every request, in order:

1. Extract the bearer token; absent → 401 challenge (below).
2. Fetch the JWKS (cached) and verify the JWT signature.
3. Verify `iss` matches the Supabase project's issuer.
4. **Verify `aud` equals the MCP resource URL.**
5. Verify `exp` / `nbf`.
6. Extract the user id claim — `sub` per OIDC; Supabase also documents a
   `user_id` claim on OAuth-issued tokens. Confirm which carries the Supabase
   user id at step 3 and read exactly one of them, never a fallback chain.

Step 4 is the one that matters most and the one most often skipped. Without an
audience check, a token Supabase issued to any other OAuth client would verify
successfully here and grant access to that user's portfolio data. A token issued
for another resource must be rejected, per the MCP authorization spec.

### Data access

Queries run through a Supabase client carrying the user's own token, so the
existing RLS policies apply unchanged and `auth.uid() = user_id` remains the
single enforcement point. See Open Question 2 for the fallback.

### Dynamic client registration

DCR allows any client to self-register. This is what makes one-click connect work
and is accepted deliberately. The mitigating control is that the consent screen
always requires explicit human approval and displays the requesting client's name
and redirect URI, so a user can recognise an unexpected client and deny it.

DCR stays **disabled** until step 5 of the build order, so there is no window in
which clients can register against a half-built endpoint.

## Error handling

| Condition | Response |
|---|---|
| Missing or invalid token | 401 with `WWW-Authenticate: Bearer resource_metadata="…"`. This is not only an error path — it is the discovery mechanism that starts the OAuth flow. |
| Valid token, user has no portfolios | Tool returns a message pointing at the upload screen, not an empty array, so Claude can say something useful instead of "you have no holdings". |
| Yahoo fetch fails for some symbols | Return partial data plus `missing_symbols`, matching the existing behaviour of `app/api/risk/route.ts`. |
| Yahoo fetch fails for all symbols | Tool error naming the upstream failure; do not return zeroed prices, which would read as real data. |
| Unknown portfolio id or name | Error listing the valid portfolio names, so Claude can retry without a round trip through the user. |
| Input fails zod validation | Tool error naming the offending field and the expected shape. |

No tool returns a partially-priced portfolio without saying so. A silently
zero-priced holding would corrupt weights, totals, and any advice built on them.

## Open questions

These are assumptions not yet verified against a running system. Each has a known
fallback, so neither blocks the design.

1. **Dot-prefixed App Router directories.** Whether `app/.well-known/…/route.ts`
   resolves correctly in Next.js 16. Fallback: a rewrite in `next.config.ts` from
   `/.well-known/:path*` to `/api/well-known/:path*`. Resolve by testing the route
   before building on it.

2. **RLS with OAuth-server-issued tokens.** Whether a token minted by the Supabase
   OAuth server resolves `auth.uid()` in PostgREST the way a normal session token
   does. Fallback: a service-role client with an explicit `.eq("user_id", userId)`
   on every query — equally safe, but moves enforcement from the database into
   application code, so RLS is preferred if it works. Resolve at step 3.

## Prerequisites (owner actions)

1. **Provide the Vercel production domain** (`PORTPULSE_ORIGIN`). Needed for the
   metadata `resource` field, the JWT audience check, Supabase's redirect
   allowlist, and the URL entered into Claude.
2. **Enable the OAuth 2.1 Server** — Supabase dashboard → Authentication → OAuth
   Server. Set **Authorization Path** to `/oauth/consent`.
3. **Confirm asymmetric JWT signing keys** — Supabase dashboard → Authentication →
   JWT Keys. JWKS verification requires ES256/RS256; a project still on the legacy
   shared HS256 secret needs the signing-key migration first.
4. *(Step 5 only)* Enable dynamic client registration.

## Build order

1. Confirm the deployed app works on the production domain — Google OAuth redirect
   URIs and Supabase Site URL both reflect it.
2. Enable the Supabase OAuth server, build `/oauth/consent`, register one client
   manually, and walk the authorization code flow by hand.
3. Build `/api/mcp` with token verification and a single tool
   (`list_portfolios`). Verify with `@modelcontextprotocol/inspector`. Resolve
   Open Questions 1 and 2 here.
4. Build the remaining five tools.
5. Enable DCR, add the connector in claude.ai, and ask a real question end to end.
6. Run `security-review` (new public endpoint, new auth path) and `verify`.

Step 1 is a genuine prerequisite: nothing in this design can be tested end to end
from localhost, because claude.ai must be able to reach the server.

## Verification

- `@modelcontextprotocol/inspector` against the deployed URL exercises the full
  OAuth discovery flow and lists the tool schemas — the fastest signal that auth
  is wired correctly.
- A request with no token returns 401 with a well-formed `WWW-Authenticate`
  challenge.
- A request bearing a token whose `aud` is not the MCP resource URL is rejected.
- User A's token cannot read user B's portfolios.
- End to end in claude.ai: "What's in my portfolios, and how concentrated am I?"
  should produce a correct answer traceable to the real database rows.
