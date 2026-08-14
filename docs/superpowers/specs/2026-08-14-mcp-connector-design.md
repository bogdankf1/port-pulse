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
- `lib/yahoo.ts` `fetchYahooChart(symbol, range, intervalOverride?)` is a
  server-side REST fetch returning `{ symbol, range, interval, currency, points }`,
  so quotes and history are obtainable without a browser. It throws
  `YahooFetchError` with a `status` field on upstream failure.
- `lib/history.ts` `fetchHistory()` is **client-side** — it fetches a relative
  `/api/history` URL, which does not resolve in a server context. Tools must call
  `fetchYahooChart` directly and must not reuse this helper.
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

All verified against the live project on 2026-08-14.

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | `kbbgyyiasbvgmfoxoeaz` |
| `PORTPULSE_ORIGIN` | `https://port-pulse-seven.vercel.app` |
| MCP resource URL | `https://port-pulse-seven.vercel.app/api/mcp` |
| Issuer (`iss`) | `https://kbbgyyiasbvgmfoxoeaz.supabase.co/auth/v1` |
| Authorization endpoint | `…/auth/v1/oauth/authorize` |
| Token endpoint | `…/auth/v1/oauth/token` |
| JWKS URL | `…/auth/v1/.well-known/jwks.json` |
| AS metadata (MCP discovery) | `https://kbbgyyiasbvgmfoxoeaz.supabase.co/.well-known/oauth-authorization-server/auth/v1` |

Confirmed from those documents:

- Signing is **ES256** (a live P-256 key is published). No signing-key migration needed.
- `code_challenge_methods_supported` includes `S256` — PKCE is available.
- `scopes_supported`: `openid`, `profile`, `email`, `phone`, `offline_access`. There
  is no mechanism for a custom scope such as `portfolio:read`, so scope cannot be
  used to distinguish a connector token from any other token.
- `offline_access` means Claude can hold a refresh token; consent is not re-prompted
  every session.
- `claims_supported` includes `sub` and not `user_id`, so `sub` is very likely the
  Supabase user id. Still confirm against a real token at step 3.
- **No `registration_endpoint`** is advertised. Expected — "Allow Dynamic OAuth
  Apps" is currently off. It should appear once DCR is enabled at step 5; if it
  does not, one-click connect is not possible and the connector must be registered
  manually with its client ID and secret pasted into Claude's Advanced settings.
- **No RFC 8707 resource indicator support** is advertised. See Open Question 3.

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
| `list_portfolios` | — | `[{ id, name, holdings_count }]` | `portfolios`, `watchlist_items` |
| `get_portfolio` | `portfolio_id` \| `name` (id wins if both given; name match is case-insensitive and must be unique, else error listing candidates) | per holding: `symbol, name, quantity, entry_price, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, weight_pct`; plus portfolio totals | `watchlist_items` + `fetchYahooChart` |
| `get_position` | `symbol` | aggregate across all portfolios: total quantity, cost basis, per-portfolio rows | mirrors `app/api/positions/[symbol]` |
| `get_price_history` | `symbol`, `range` (`1D\|1M\|3M\|YTD\|1Y\|5Y`) | `{ symbol, range, interval, currency, points[] }` | `lib/yahoo.ts` `fetchYahooChart` |
| `get_risk_metrics` | `portfolio_id` | `{ sharpe, beta, volatility, max_drawdown, benchmark, sample_days, missing_symbols? }` | `lib/riskMetrics.ts`, benchmark SPY, 1Y window |
| `get_sector_breakdown` | `portfolio_id` | `[{ sector, value, percent, symbols[] }]` | `lib/sectorMap.ts` |

Claude performs the analysis itself from these outputs.

`list_portfolios` deliberately does not return market value. Doing so would mean
fetching a quote for every symbol in every portfolio just to answer "what
portfolios exist" — the one call Claude makes most often and needs to be cheap.
Value comes from `get_portfolio`, once Claude knows which portfolio it wants.

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
2. Fetch the JWKS (cached) and verify the ES256 signature.
3. Verify `iss` equals `https://kbbgyyiasbvgmfoxoeaz.supabase.co/auth/v1`.
4. Verify `exp` / `nbf`.
5. Audience binding — see Open Question 3. Strict `aud` checking is the intent;
   whether the authorization server can satisfy it is unresolved.
6. Extract the user id from `sub`. Read exactly one claim, never a fallback chain
   across several claim names — a fallback chain turns a claim-shape surprise into
   a silent authorization bug.

Audience binding is the check that normally matters most here and the one most
often skipped. Without it, any token this Supabase project issued to any OAuth
client is accepted by the MCP endpoint.

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

1. **Dot-prefixed App Router directories.** ✅ **RESOLVED YES** (2026-08-14,
   Next.js 16.2.6 dev server). `app/.well-known/oauth-protected-resource/api/mcp/route.ts`
   serves at its literal path and returns 200. **No `next.config.ts` rewrite is
   needed** and none was added.

   Original question: whether `app/.well-known/…/route.ts` resolves in Next.js 16.
   Fallback would have been a rewrite from `/.well-known/:path*` to
   `/api/well-known/:path*`.

2. **RLS with OAuth-server-issued tokens.** ✅ **RESOLVED YES** (2026-08-14, probe
   client against the live project). An OAuth-issued token resolves `auth.uid()`
   in PostgREST exactly like a normal session token. `GET /rest/v1/portfolios`
   with the token returned both of the owner's rows; the same request with only
   the anon key returned `[]`. The OIDC-only scope list was not evidence against
   it — the token carries `role: "authenticated"` and is structurally an ordinary
   Supabase user JWT.

   **Consequence:** tools use a user-scoped client carrying the caller's token,
   and RLS stays the single enforcement point. The service-role fallback is not
   needed and should not be built.

   Original question: whether a token minted by the Supabase OAuth server
   resolves `auth.uid()` in PostgREST the way a normal session token does. The
   advertised scopes are OIDC-only (`openid`, `profile`, `email`, `phone`,
   `offline_access`) with nothing describing database access, which was mild
   evidence against it. Fallback would have been a service-role client with an
   explicit `.eq("user_id", userId)` on every query.

3. **Audience binding (RFC 8707).** ❌ **RESOLVED NO** (2026-08-14, same probe).
   The authorization request carried
   `resource=https://port-pulse-seven.vercel.app/api/mcp`. It was **silently
   ignored** — no error, no echo. The minted token's `aud` is the constant
   string **`"authenticated"`**.

   This is *worse* than the predicted failure mode. The guess was `aud` = the
   client ID, which is at least client-specific. `"authenticated"` is the same
   value in every user token this project issues, so it carries no binding
   information whatsoever.

   **Consequence — the residual risk is wider than written below.** It is not
   "any token issued to any OAuth client"; it is **any Supabase token this
   project ever issues for this user, including an ordinary web-app session
   token from a normal Google sign-in.** Those are not OAuth-client tokens at
   all, and they are equally accepted at `/api/mcp`.

   No substitute binding is available. The token does carry `client_id` and
   `scope` claims, but `client_id` cannot be pinned — Claude registers its own
   client dynamically (Task 17), so its value is not known ahead of time.

   The verifier therefore checks signature + issuer + expiry only, and
   `lib/mcp/auth.ts` must not grow a strict `aud` check.

   Why that residual risk is acceptable *for this design specifically*: every tool
   is read-only and returns exactly the rows RLS already grants that token, so a
   replayed token gains no authority it did not already have via PostgREST. The
   boundary is RLS either way — and Open Question 2 confirms RLS genuinely is the
   boundary.

   Why it is nonetheless recorded as a real limitation: this reasoning collapses
   the moment a write tool is added. **Do not add write tools while Open Question 3
   is unresolved in the negative** — a replayed token that can only read is a
   non-event, and one that can delete a portfolio is not. Custom scopes are not
   available as a substitute control (see Named inputs).

## Prerequisites (owner actions)

1. ~~Provide the Vercel production domain.~~ **Done** —
   `https://port-pulse-seven.vercel.app`.
2. ~~Enable the OAuth 2.1 Server with authorization path `/oauth/consent`.~~
   **Done** — verified via the dashboard; Site URL is set to the production domain.
3. ~~Confirm asymmetric JWT signing keys.~~ **Done** — JWKS publishes a live ES256
   key, so no signing-key migration is needed. (There is no "JWT Keys" tab under
   Authentication in the current dashboard; reading the JWKS endpoint answers the
   question directly and is the check to repeat if this is ever revisited.)
4. *(Step 5 only)* Enable "Allow Dynamic OAuth Apps", then re-read the AS metadata
   to confirm a `registration_endpoint` appeared.

## Build order

1. Confirm sign-in works on `https://port-pulse-seven.vercel.app` — Google OAuth
   redirect URIs and Supabase Site URL both reflect the production domain. (Deploy
   and OAuth-server config are already done; this is a verification, not a task.)
2. Build `/oauth/consent`, register one OAuth client manually, and walk the
   authorization code flow by hand. **Decode the resulting access token and record
   its `aud`, `sub`, and `role` claims** — this single observation resolves Open
   Question 3 and informs Open Question 2, and both shape the code in step 3.
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
