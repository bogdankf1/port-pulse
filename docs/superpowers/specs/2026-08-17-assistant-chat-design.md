# Port Pulse Assistant — Design (Spec A)

**Date:** 2026-08-17
**Status:** Approved, pending implementation plan
**Backlog:** `IDEAS.md` items 1, 2, 3 (and retires item 10)

## Goal

Turn the one-shot AI report into a **two-way conversational assistant on its own
page**, grounded in the user's real portfolio data through the tool surface that
already exists for the MCP connector.

Today the user can press a button and read a fixed five-section report. They
cannot ask a follow-up, drill into a holding, compare two portfolios, or ask
anything the report's authors didn't anticipate.

## Non-goals

- **No memory.** Preferences, risk tolerance, learned facts, recall ranking —
  all Spec B. This spec persists *conversations*, which is a different and much
  smaller thing.
- **No graph retrieval.** Deliberately deferred: 12–25 holdings fit in a prompt,
  and the relationships a graph would encode (correlation, factor exposure) are
  **computed from price history, not stored facts** — edges would be a cache that
  goes stale and gets recomputed anyway. Graph RAG earns its complexity against a
  real corpus (filings, news, years of history). Revisit then.
- **No writes, ever.** The assistant reads and analyses. It never places a trade,
  never mutates broker or account state, and every tool it can reach is read-only
  (`IDEAS.md` item 6). This is satisfied by construction — the six tools have no
  write path — not by policy.
- **No changes to `lib/mcp/`.** The remote MCP connector keeps working unchanged.
  Both callers share one implementation.
- **No deep-linking to a conversation.** `/assistant` with in-page switching;
  `/assistant/[id]` is a follow-up.

## Background

### What exists today

`components/InsightsDrawer.tsx` → `POST /api/insights` → `lib/insights.ts`:

- **Unauthenticated.** The route never touches Supabase. The client POSTs its own
  holdings and the server stuffs them into a prompt (`app/api/insights/route.ts:41`).
- **No tool use at all.** `lib/insights.ts:77` is a plain `client.messages.stream`
  with `max_tokens: 2048`. There is no tool loop to extend.
- **Pinned to `claude-opus-4-7`** (`lib/insights.ts:3`) — a generation behind.
- **Streams a bespoke chunk protocol** parsed by `components/insights/stream.ts`.
- **Carries a live bug** (`IDEAS.md` item 10): `useInsights`' auto-fetch depends on
  a cache key containing the live price, so while the drawer is open it re-fires
  on every tick, and its `sessionStorage` cache can never hit during market hours.

So "make the insights conversational" is not a refactor of an existing loop —
there is no loop. It is a new capability, and it forces an auth decision the
current design never had to make.

### The tool surface being reused

Six read-only tools, registered in `app/api/mcp/route.ts`, implemented in
`lib/mcp/tools.ts`: `list_portfolios`, `get_portfolio`, `get_position`,
`get_price_history`, `get_risk_metrics`, `get_sector_breakdown`.

Every one takes an `McpAuthContext` as its first argument and calls
`createUserClient(ctx)` (`lib/mcp/supabase.ts:14`), which builds a Supabase
client with `Authorization: Bearer ${ctx.token}` against the **anon** key — so
**RLS applies as that user**. Of the context's five fields only `token` is
load-bearing; `clientId` and `scopes` are bookkeeping for the MCP auth layer and
the tool bodies never read them.

**This is what makes the whole spec cheap.** A cookie session also has an access
token, so an `McpAuthContext` can be constructed from one in about ten lines, and
all six functions become callable unchanged with RLS intact.

### Current schema

Two tables, `portfolios` and `watchlist_items` (`supabase/schema.sql`), both with
RLS scoping rows to `auth.uid() = user_id`. Conversations need new tables.

## Decisions

Settled with the owner before writing this.

| # | Decision | Chosen |
|---|---|---|
| 1 | How the assistant reaches data | **Authenticated server-side tool loop** |
| 2 | Scope | **Two specs; this is A. Graph deferred** |
| 3 | The old report and its surfaces | **Retire all of them** |
| 4 | Signed-out users | **Entry point visible, prompts sign-in** |
| 5 | Chat history | **Persisted in Spec A** |

Rejected, with reasons worth keeping:

- **Client sends context (today's model).** Would stay unauthenticated and work
  signed out, but the assistant could only ever see what the client already has —
  the active portfolio's holdings and live prices. No cross-portfolio questions,
  no price history, and full context billed on every turn regardless of question.
- **Hybrid authed-plus-guest.** Most capable, but two code paths, two prompt
  shapes and two sets of failure modes for a feature with one primary user.
- **Keeping the report alongside the chat.** Would preserve the guest path, but
  leaves three AI surfaces to maintain and leaves item 10 needing a separate fix.

Decided while writing, stated so they are not rediscovered:

- **Per-user in-flight guard: yes. Daily message cap: no.** One concurrent
  assistant request per user is cheap insurance against an accidental loop on a
  paid endpoint. A daily cap is friction without benefit for a single-user
  personal app; the broader rate-limiting question stays with `IDEAS.md` item 12,
  which auth has already defused the anonymous half of.
- **Guests lose the report.** Accepted consequence of decision 1 — `/api/insights`
  was the last unauthenticated AI path.

## Architecture

One page, one endpoint, three new `lib/` modules.

```
app/assistant/page.tsx            → AssistantView (client)
        │  POST /api/assistant    (SSE)
        ▼
app/api/assistant/route.ts
        │  getUser()   → authenticate (401 if absent)
        │  getSession() → access_token
        │  mcpContextFromSession()
        ▼
lib/assistant/context.ts   McpAuthContext from a cookie session
lib/assistant/tools.ts     six tool defs wrapping lib/mcp/* unchanged
lib/assistant/loop.ts      tool runner, streaming, refusal handling
lib/assistant/protocol.ts  SSE event encode/decode
lib/assistant/persist.ts   conversation + message reads/writes
```

### Authentication

`createServerSupabase()` then **`auth.getUser()` to authenticate** — it validates
the JWT, unlike `getSession()`, which only reads cookies — and then
`auth.getSession()` to obtain `access_token` for the tool context. 401 if either
is absent. Same cookie path as `/api/watchlist`, `/api/portfolios`, `/api/compare`.

### The context adapter

```ts
// lib/assistant/context.ts
export function mcpContextFromSession(
  userId: string,
  accessToken: string,
): McpAuthContext {
  return {
    userId,
    token: accessToken,
    // Inert here: the MCP auth layer records these for OAuth clients, and no
    // tool body reads them. createUserClient only uses `token`.
    clientId: "port-pulse-app",
    scopes: [],
  };
}
```

That is the entire bridge between the two auth models.

## Components

### New

| Path | Responsibility |
|---|---|
| `app/assistant/page.tsx` | Route shell |
| `app/api/assistant/route.ts` | Auth, SSE response, orchestration |
| `lib/assistant/context.ts` | Cookie session → `McpAuthContext` |
| `lib/assistant/tools.ts` | Six tool definitions via `betaZodTool`, Zod arg schemas — consistent with the Zod validation `lib/mcp/tools.ts` already uses |
| `lib/assistant/loop.ts` | Tool runner, streaming, refusal handling |
| `lib/assistant/protocol.ts` | SSE event shapes and codec |
| `lib/assistant/persist.ts` | Conversation/message persistence |
| `lib/assistant/prompts.ts` | System prompt + the 15 starters |
| `components/assistant/AssistantView.tsx` | Page composition, conversation switching |
| `components/assistant/MessageList.tsx` | Transcript, auto-scroll |
| `components/assistant/Composer.tsx` | Input, send, stop |
| `components/assistant/ToolStatus.tsx` | "checking your risk metrics…" |
| `components/assistant/SuggestionChips.tsx` | 3-of-15 starters |
| `supabase/schema.sql` | Two tables + RLS |

### Deleted

| Path | Note |
|---|---|
| `components/InsightsDrawer.tsx` | Replaced by the page |
| `components/insights/useInsights.ts` | **Carries item 10's bug — deleted, not fixed** |
| `components/insights/stream.ts` | Bespoke protocol superseded |
| `components/insights/SectionCard.tsx` | Fixed-section UI has no successor |
| `components/mobile/sheet/InsightsTab.tsx` | Becomes a link to `/assistant` |
| `lib/insights.ts` | Superseded by `lib/assistant/` |
| `app/api/insights/route.ts` | Superseded by `/api/assistant` |

### Changed

| Path | Change |
|---|---|
| `components/WatchlistDashboard.tsx` | Insights button → `Link` to `/assistant`; sheet AI tab → link; drawer state removed |

## Data flow

| Need | Source | New? |
|---|---|---|
| Holdings, values, P&L, weights | `getPortfolio` / `listPortfolios` | no |
| Single position across portfolios | `getPosition` | no |
| Price history | `getPriceHistory` | no |
| Sharpe / beta / vol / max drawdown | `getRiskMetrics` | no |
| Sector allocation | `getSectorBreakdown` | no |
| Conversation transcript | `assistant_messages` | **yes** |

### Streaming protocol

SSE, four event kinds:

| Event | Payload | Purpose |
|---|---|---|
| `text` | `{ delta }` | Token deltas |
| `tool` | `{ name, status: "running" \| "done" }` | Legible waiting |
| `done` | `{ conversationId, messageId }` | Client reconciles persistence |
| `error` | `{ message }` | Surfaced in the transcript |

The `tool` event is not decoration. A tool loop plus thinking means multi-second
first tokens; without it the user watches a blank pane.

### Model configuration

- **`claude-opus-5`** — replaces the `claude-opus-4-7` pin.
- **Adaptive thinking** (on by default on this model) with `effort: "high"`.
- **Streaming**, via the tool runner's `stream: true`.
- **`fallbacks: "default"`** with beta `server-side-fallback-2026-07-01`, so a
  safety-classifier decline is re-run rather than surfaced as a dead end.
  **`stop_reason === "refusal"` is checked before reading content.**
- **Prompt caching** on the system prompt and tool definitions — the stable
  prefix, comfortably over this model's 512-token cache minimum.

### Schema

```sql
create table if not exists assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references assistant_conversations(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;

create policy "Users manage own conversations" on assistant_conversations
  for all using (auth.uid() = user_id);
create policy "Users manage own messages" on assistant_messages
  for all using (auth.uid() = user_id);
```

`user_id` is denormalised onto messages so RLS is a single-table predicate rather
than a join, matching how `watchlist_items` already does it.

**Messages persist as text only — no `tool_use`/`tool_result` blocks.** This is
the correct choice, not the lazy one: tool results are point-in-time market data,
and replaying last week's prices into a resumed conversation would make the
assistant confidently wrong about a live portfolio. Fresh tool calls per turn is
right for a live book. The stored text is the conversation; it is not the evidence.

`title` is derived from the first user message (truncated), not model-generated —
one fewer call on a paid path.

## The system prompt

Four jobs, stated here so the plan doesn't invent them:

1. **Frame the context.** Which portfolio the user was viewing when they opened
   the page, so "how am I doing?" resolves without a clarifying question.
2. **Force grounding.** Numbers come from tools, never from the model's memory of
   an earlier turn. Prices move between turns.
3. **State the read-only boundary.** The assistant analyses; it does not advise on
   or execute transactions.
4. **Calibrate length.** This model defaults verbose; a short conciseness
   instruction is worth more than trimming afterwards.

## The 15 starter prompts

Three chosen at random after mount (never during render — a hydration mismatch
otherwise). All answerable from the six tools; none solicit trade advice.

1. What are my biggest risks right now?
2. How concentrated is this portfolio?
3. How diversified am I by sector?
4. What's driving today's moves?
5. If the market dropped 10%, which positions would hurt most?
6. Which of my holdings duplicate each other's exposure?
7. What's my best and worst performer?
8. How have I done against the S&P 500 this year?
9. Is my beta what I'd expect from these holdings?
10. Which positions contribute most to my volatility?
11. Walk me through my sector allocation.
12. Summarise this portfolio for someone seeing it for the first time.
13. What's changed most in the last month?
14. How much of my gain comes from a single holding?
15. What should I understand about this portfolio that isn't obvious?

Dynamic variants are **string-built on the client** from data it already holds
("What's driving NVDA today?") — no extra model call, which removes the cost and
latency objection in `IDEAS.md` item 3's open question.

## Error handling

Each failure is contained; none blanks the page.

| Failure | Behaviour |
|---|---|
| No session | 401. Page shows the sign-in prompt rather than an error |
| A tool throws | Its `tool_result` carries `is_error: true`; the model recovers or says it couldn't retrieve that. The turn does not fail |
| Yahoo unavailable | Same path — a failed `get_price_history` is a tool error, not a request error |
| `stop_reason: "refusal"` | `fallbacks: "default"` re-runs on the fallback model; if the chain refuses, surfaced as an assistant message, not a crash |
| Stream drops mid-turn | Partial assistant text is persisted on the server as the turn completes, so a reload shows what was produced |
| Request already in flight | 409 from the per-user guard; composer disabled client-side so this is a backstop |
| Persistence write fails | The turn still streams; the transcript is degraded, not lost mid-answer. Logged, not silently swallowed |

## Risks

**The tool runner is beta.** `client.beta.messages.toolRunner` is a beta SDK
surface under a shipped feature.

*Availability verified while writing this spec* — it is present in the installed
`@anthropic-ai/sdk` 0.95.1 (`resources/beta/messages/messages.d.ts`), and
`helpers/beta/zod` ships alongside it, with `zod ^4.4.3` already a dependency. So
there is no discovery risk; the remaining risk is that a beta surface can change
under us. If it does, `lib/assistant/loop.ts` is the only module that would
differ — a manual `while (stop_reason === "tool_use")` loop is a contained
fallback.

One documented caveat that does **not** apply here: the runner does not
auto-resume `pause_turn`. That only arises with Anthropic-hosted server tools
(web search, code execution). Every tool here is a local function, so the turn
cannot pause.

**Cost per turn is unbounded.** One question can fan out several tool calls, each
hitting Supabase and Yahoo. Auth removes anonymous abuse; the in-flight guard
removes accidental loops; a genuinely expensive conversation is still possible and
is accepted for a single-user app.

**Latency.** Tool loop plus thinking means seconds before first text. Mitigated by
`tool` events, not eliminated.

**Deleting the guest report is one-way.** If signed-out AI turns out to matter,
the hybrid option is the fallback — noted in Decisions above.

## Verification

Automated (Vitest, `environment: "node"`, `include: ["lib/**/*.test.ts"]` — so
`lib/` only; no component tests, and none should be written):

- `lib/assistant/context.ts` — context shape from a session; that `token` is the
  access token and `userId` matches.
- `lib/assistant/protocol.ts` — encode/decode round-trip for all four event kinds,
  including a `text` delta containing a newline and one containing `data:`.
- `lib/assistant/tools.ts` — argument validation per tool; unknown tool rejected.
- `lib/assistant/persist.ts` — title derivation from a first message (truncation,
  whitespace, an empty message).

Manual, via the `verify` skill, before this is called done:

- 393px and 1440px: the page is usable at both; the composer is reachable above
  the iOS keyboard.
- Signed out: the entry point renders and prompts sign-in; `/api/assistant` 401s.
- A tool-using question (e.g. #9, which needs `get_risk_metrics`) shows `tool`
  status then a grounded answer citing real numbers.
- A cross-portfolio question, which the old report could not answer at all.
- Reload mid-conversation: transcript restored.
- Both themes; `prefers-reduced-motion`.
- Desktop dashboard: Insights button navigates rather than opening a drawer;
  nothing else regressed.

## Build order

1. Schema + RLS; verify a second user cannot read the first's conversations.
2. `lib/assistant/context.ts` + tests.
3. `lib/assistant/protocol.ts` + tests.
4. `lib/assistant/tools.ts` + tests — six tools over the unchanged MCP functions.
5. `lib/assistant/loop.ts` — tool runner with `stream: true`, refusal handling.
6. `app/api/assistant/route.ts` — auth, SSE, in-flight guard.
7. `lib/assistant/persist.ts` + tests; wire into the route.
8. `components/assistant/*` and the page.
9. Retire the old surfaces; repoint the dashboard button and the sheet tab.
10. Verification pass.

Steps 1–7 are the whole feature minus a UI; step 9 is where the old code dies and
should not happen earlier, so the branch always has a working AI path.
