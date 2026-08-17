# Portfolio Assistant Implementation Plan (Spec A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot AI report with an authenticated, tool-grounded conversational assistant on its own page at `/assistant`.

**Architecture:** A client page posts to one SSE endpoint. The endpoint authenticates via the Supabase cookie session, converts that session into the `McpAuthContext` the existing MCP tool functions already expect, and runs the Anthropic SDK's tool runner over six read-only tools. Conversations persist as text in two new RLS-scoped tables. `lib/mcp/` is not modified — the remote MCP connector and the assistant share one tool implementation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase (auth + Postgres), `@anthropic-ai/sdk` 0.95.1 (beta tool runner), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-assistant-chat-design.md`

---

## Before you start

Read the spec. It records why each decision was made and which alternatives lost.

**Testing reality.** `vitest.config.ts` is `environment: "node"` with `include: ["lib/**/*.test.ts"]`. Only files under `lib/` are collected. There is **no jsdom and no React Testing Library**, so:

- A test at `components/**` or `app/**` **will never run**. Do not write one.
- Do not add a DOM test stack. Out of scope.

Logic that deserves testing therefore belongs in `lib/`. Components are verified with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and a browser pass.

**Commands:**

```bash
npm test                 # vitest run
npx tsc --noEmit         # type check (no typecheck script exists)
npm run lint             # eslint
npm run build            # required for tasks touching routes or server-only imports
npm run dev              # dev server on :3000
```

**Environment notes carried from prior sessions:**

- `resize_window` does **not** change the CSS layout viewport in this harness. For mobile checks, load the app in a **same-origin iframe** sized to the target and reload it per size.
- A stale `wealth-vault-v1` service worker has been seen squatting on `localhost:3000`, serving cached JS through hard reloads. Port Pulse registers none. Unregister it if you see pre-change behaviour.
- Next's dev-tools badge sits bottom-left. Not app UI.

**Baseline:** 80 tests across 7 files, all green, on `main`.

**Branch:** create `feat/assistant-chat` from `main`.

---

## Facts already verified — do not re-litigate

These were checked while writing the spec. They shape the code below.

1. **`client.beta.messages.toolRunner` exists** in the installed `@anthropic-ai/sdk` 0.95.1 (`resources/beta/messages/messages.d.ts`), and `helpers/beta/zod` ships with it. `zod ^4.4.3` is already a dependency.
2. **`betaZodTool` cannot be used here — do not try.** It builds `input_schema` via `z.toJSONSchema(schema, { reused: 'ref' })` with no `io` override, so zod defaults to `"output"` mode and **throws `"Transforms cannot be represented in JSON Schema"`** on any schema containing a `.transform()`. `getPositionSchema` and `getPriceHistorySchema` both transform `symbol`, so `assistantTools()` would throw before returning. Verified against the installed helper and reproduced directly; not a version fluke. Task 4 therefore ships a local `zodTool()` that mirrors `betaZodTool`'s exact returned shape (`{ type: 'custom', name, input_schema, description, run, parse }`) but generates the schema with `{ io: "input" }` — which is the semantically correct thing for a tool input schema anyway, since it describes what the model must send rather than what parsing produces. `.parse()` still runs the original schema, transform and refine included.
3. **`toolRunner({ ..., stream: true })` returns `BetaToolRunner<true>`**, which is async-iterable yielding one `BetaMessageStream` per model turn (`lib/tools/BetaToolRunner.d.ts:17`), plus `.done()` for the final message. Each `BetaMessageStream` is itself async-iterable over `BetaMessageStreamEvent` and exposes `finalMessage()` (`lib/BetaMessageStream.d.ts:109,119`).
4. **`StopReason` includes `'refusal'`** (`resources/messages/messages.d.ts:962`), so the refusal check in Task 7 is a typed comparison, not a string guess.
5. **`lib/mcp/tools.ts` already exports `z.object(...)` schemas** for all six tools: `listPortfoliosSchema`, `getPortfolioSchema`, `getPositionSchema`, `getPriceHistorySchema`, `getRiskMetricsSchema`, `getSectorBreakdownSchema`. Pass them straight to `betaZodTool`.
6. **All six tool functions take `McpAuthContext` first**, and `createUserClient(ctx)` (`lib/mcp/supabase.ts:14`) uses only `ctx.token`, as a bearer against the **anon** key — so **RLS applies as that user**. `clientId`/`scopes` are unread by tool bodies.
7. **`createServerSupabase()`** (`lib/supabase-server.ts`) returns an `@supabase/ssr` server client over cookies.

---

## File structure

**New — tested**

| File | Responsibility |
|---|---|
| `lib/assistant/context.ts` | Cookie session → `McpAuthContext` |
| `lib/assistant/context.test.ts` | |
| `lib/assistant/protocol.ts` | SSE event types + encoder + streaming decoder |
| `lib/assistant/protocol.test.ts` | |
| `lib/assistant/tools.ts` | Six `betaZodTool` definitions over the unchanged MCP functions |
| `lib/assistant/tools.test.ts` | |
| `lib/assistant/prompts.ts` | System prompt builder + the 15 starters |
| `lib/assistant/prompts.test.ts` | |
| `lib/assistant/persist.ts` | Conversation/message persistence + title derivation |
| `lib/assistant/persist.test.ts` | |

**New — not tested (no jsdom / server-only)**

| File | Responsibility |
|---|---|
| `lib/assistant/loop.ts` | Tool runner, streaming, refusal handling |
| `app/api/assistant/route.ts` | Auth, in-flight guard, SSE response |
| `app/assistant/page.tsx` | Route shell |
| `components/assistant/AssistantView.tsx` | Page composition, conversation switching |
| `components/assistant/MessageList.tsx` | Transcript + auto-scroll |
| `components/assistant/Composer.tsx` | Input, send, stop |
| `components/assistant/SuggestionChips.tsx` | 3-of-15 starters |
| `components/assistant/SignInPrompt.tsx` | Guest state |

**Modified**

| File | Change |
|---|---|
| `supabase/schema.sql` | Two tables + RLS |
| `components/WatchlistDashboard.tsx` | Insights button → `Link`; sheet AI tab → link; drawer state removed |
| `types/index.ts` | `AssistantMessage`, `AssistantConversation` |

**Deleted (Task 10 only — not before)**

`components/InsightsDrawer.tsx`, `components/insights/useInsights.ts`, `components/insights/stream.ts`, `components/insights/SectionCard.tsx`, `components/mobile/sheet/InsightsTab.tsx`, `lib/insights.ts`, `app/api/insights/route.ts`

---

## Task 1: Schema and RLS

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Append the tables**

Add to `supabase/schema.sql`:

```sql
-- Assistant conversations (Spec A). Text-only transcripts: tool results are
-- point-in-time market data, so replaying them into a resumed conversation
-- would make the assistant confidently wrong about a live portfolio.
create table if not exists assistant_conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists assistant_messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references assistant_conversations(id) on delete cascade not null,
  -- Denormalised so RLS is a single-table predicate rather than a join,
  -- matching how watchlist_items already does it.
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists assistant_messages_conversation_idx
  on assistant_messages (conversation_id, created_at);
create index if not exists assistant_conversations_user_idx
  on assistant_conversations (user_id, updated_at desc);

alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;

create policy "Users manage own conversations"
  on assistant_conversations for all using (auth.uid() = user_id);

create policy "Users manage own assistant messages"
  on assistant_messages for all using (auth.uid() = user_id);
```

- [ ] **Step 2: Apply it**

Run the new statements in the Supabase SQL editor for this project. `create table if not exists` and `create index if not exists` are idempotent, but **`create policy` is not** — if a policy of that name already exists the statement errors. In that case drop it first:

```sql
drop policy if exists "Users manage own conversations" on assistant_conversations;
drop policy if exists "Users manage own assistant messages" on assistant_messages;
```

- [ ] **Step 3: Verify RLS actually isolates users**

This is the security boundary for a table holding the user's financial conversations. Do not assume it works.

In the Supabase SQL editor:

```sql
-- Both tables must report rowsecurity = true.
select tablename, rowsecurity from pg_tables
where tablename in ('assistant_conversations', 'assistant_messages');

-- Each table must have exactly one permissive policy for all commands.
select tablename, policyname, cmd from pg_policies
where tablename in ('assistant_conversations', 'assistant_messages');
```

Expected: `rowsecurity` true for both; one policy each.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(assistant): conversations and messages schema with RLS"
```

---

## Task 2: The session → MCP context adapter

This is the whole bridge between the cookie-session world and the bearer-token world the MCP tools were built for. Ten lines, but everything depends on it.

**Files:**
- Create: `lib/assistant/context.ts`
- Test: `lib/assistant/context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/assistant/context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mcpContextFromSession } from "./context";

describe("mcpContextFromSession", () => {
  it("carries the user id and uses the access token as the bearer", () => {
    const ctx = mcpContextFromSession("user-123", "eyJhbGciOi.token.sig");
    expect(ctx.userId).toBe("user-123");
    // createUserClient sends this as `Authorization: Bearer ${ctx.token}`
    // against the anon key, which is what keeps RLS applying as this user.
    expect(ctx.token).toBe("eyJhbGciOi.token.sig");
  });

  it("fills the OAuth-only fields with inert values", () => {
    const ctx = mcpContextFromSession("user-123", "tok");
    expect(ctx.clientId).toBe("port-pulse-app");
    expect(ctx.scopes).toEqual([]);
  });

  it("does not invent an expiry", () => {
    // The cookie session's own refresh handles expiry; a fabricated `exp`
    // here would be a lie that some future caller might trust.
    expect(mcpContextFromSession("u", "t").expiresAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- lib/assistant/context.test.ts`
Expected: FAIL — `Failed to resolve import "./context"`.

- [ ] **Step 3: Implement**

Create `lib/assistant/context.ts`:

```ts
import type { McpAuthContext } from "@/lib/mcp/auth";

/**
 * Build the context `lib/mcp/tools.ts` expects from a Supabase **cookie**
 * session.
 *
 * The MCP tool functions were written for the remote connector, which arrives
 * with a bearer token and no cookie. They are reusable here because
 * `createUserClient` only reads `ctx.token` — it sends it as
 * `Authorization: Bearer …` against the **anon** key, so RLS still applies as
 * this user. A cookie session has an access token too, so the two auth models
 * meet here and nowhere else.
 *
 * Do **not** route through `lib/mcp/auth.ts`: that verifies bearer tokens
 * against JWKS for the OAuth flow, which is not what is happening in-app.
 */
export function mcpContextFromSession(
  userId: string,
  accessToken: string,
): McpAuthContext {
  return {
    userId,
    token: accessToken,
    // OAuth bookkeeping the MCP layer records for real clients. No tool body
    // reads either field; they exist to satisfy the shared type.
    clientId: "port-pulse-app",
    scopes: [],
    // Deliberately absent — the cookie session owns refresh, and a fabricated
    // `exp` would be a claim a later caller might act on.
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/assistant/context.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Type check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/context.ts lib/assistant/context.test.ts
git commit -m "feat(assistant): cookie session to MCP auth context adapter

Lets the six existing lib/mcp tool functions run in-app unchanged. RLS is
preserved because createUserClient uses the token as a bearer against the
anon key, exactly as it does for the remote connector."
```

---

## Task 3: The SSE protocol

**Files:**
- Create: `lib/assistant/protocol.ts`
- Test: `lib/assistant/protocol.test.ts`

**Why this is its own module with real tests:** SSE frames are newline-delimited, and the assistant streams arbitrary model text. A delta containing `\n` or the literal string `data:` would corrupt the framing if concatenated naively. JSON-encoding each event prevents that, and the decoder has to survive chunk boundaries splitting a frame.

- [ ] **Step 1: Write the failing tests**

Create `lib/assistant/protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createEventDecoder,
  encodeEvent,
  type AssistantEvent,
} from "./protocol";

function roundTrip(events: AssistantEvent[]): AssistantEvent[] {
  const decode = createEventDecoder();
  return events.flatMap((e) => decode(encodeEvent(e)));
}

describe("encodeEvent / createEventDecoder", () => {
  it("round-trips every event kind", () => {
    const events: AssistantEvent[] = [
      { kind: "text", delta: "Hello" },
      { kind: "tool", name: "get_risk_metrics", status: "running" },
      { kind: "tool", name: "get_risk_metrics", status: "done" },
      { kind: "done", conversationId: "c1", messageId: "m1" },
      { kind: "error", message: "upstream failed" },
    ];
    expect(roundTrip(events)).toEqual(events);
  });

  it("survives a delta containing newlines", () => {
    const e: AssistantEvent = { kind: "text", delta: "line one\nline two\n\n" };
    expect(roundTrip([e])).toEqual([e]);
  });

  it("survives a delta that looks like SSE framing", () => {
    const e: AssistantEvent = { kind: "text", delta: "data: not an event\n\n" };
    expect(roundTrip([e])).toEqual([e]);
  });

  it("reassembles a frame split across chunks", () => {
    const wire = encodeEvent({ kind: "text", delta: "split me" });
    const cut = Math.floor(wire.length / 2);
    const decode = createEventDecoder();
    expect(decode(wire.slice(0, cut))).toEqual([]);
    expect(decode(wire.slice(cut))).toEqual([{ kind: "text", delta: "split me" }]);
  });

  it("decodes several frames arriving in one chunk", () => {
    const wire =
      encodeEvent({ kind: "text", delta: "a" }) +
      encodeEvent({ kind: "text", delta: "b" });
    expect(createEventDecoder()(wire)).toEqual([
      { kind: "text", delta: "a" },
      { kind: "text", delta: "b" },
    ]);
  });

  it("ignores a malformed frame rather than throwing", () => {
    const decode = createEventDecoder();
    expect(decode("data: {not json}\n\n")).toEqual([]);
    // and keeps working afterwards
    expect(decode(encodeEvent({ kind: "text", delta: "ok" }))).toEqual([
      { kind: "text", delta: "ok" },
    ]);
  });

  it("holds an incomplete trailing frame until it completes", () => {
    const decode = createEventDecoder();
    expect(decode('data: {"kind":"text","delta":"pending"}')).toEqual([]);
    expect(decode("\n\n")).toEqual([{ kind: "text", delta: "pending" }]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- lib/assistant/protocol.test.ts`
Expected: FAIL — cannot resolve `./protocol`.

- [ ] **Step 3: Implement**

Create `lib/assistant/protocol.ts`:

```ts
/** One frame of the assistant's SSE stream. */
export type AssistantEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool"; name: string; status: "running" | "done" }
  | { kind: "done"; conversationId: string; messageId: string }
  | { kind: "error"; message: string };

const FRAME_SEPARATOR = "\n\n";

/**
 * JSON-encode the whole event onto one `data:` line.
 *
 * Model text can contain newlines and can contain the literal `data:`, either
 * of which would corrupt SSE framing if written raw. JSON escaping makes the
 * payload opaque to the framing.
 */
export function encodeEvent(event: AssistantEvent): string {
  return `data: ${JSON.stringify(event)}${FRAME_SEPARATOR}`;
}

/**
 * Stateful decoder. Chunk boundaries fall wherever the network puts them, so a
 * frame can arrive in pieces and several frames can arrive at once — the
 * returned function buffers the remainder between calls.
 */
export function createEventDecoder(): (chunk: string) => AssistantEvent[] {
  let buffer = "";

  return function decode(chunk: string): AssistantEvent[] {
    buffer += chunk;
    const out: AssistantEvent[] = [];

    let idx = buffer.indexOf(FRAME_SEPARATOR);
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + FRAME_SEPARATOR.length);

      const line = frame.startsWith("data: ") ? frame.slice(6) : null;
      if (line !== null) {
        try {
          out.push(JSON.parse(line) as AssistantEvent);
        } catch {
          // A malformed frame is dropped, not thrown: one bad frame must not
          // kill a stream that is still delivering good ones.
        }
      }

      idx = buffer.indexOf(FRAME_SEPARATOR);
    }

    return out;
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/assistant/protocol.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the framing tests actually bite**

Temporarily change `encodeEvent` to `return \`data: ${event.kind === "text" ? event.delta : JSON.stringify(event)}\n\n\`;` — the naive version. The newline and `data:` tests must FAIL. Revert.

If they still pass, the tests aren't pinning what they claim — say so rather than committing.

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/protocol.ts lib/assistant/protocol.test.ts
git commit -m "feat(assistant): SSE event protocol with a chunk-safe decoder"
```

---

## Task 4: The tool layer

> **AMENDED DURING EXECUTION — the code below is superseded.** The `betaZodTool`
> version in Step 3 **throws at runtime** for the reason in verified-fact #2
> above. The shipped implementation (commits `df5fbc4` + `b8c9483`) uses a local
> `zodTool()` instead. Two further defects were found and fixed on top of it:
>
> 1. Its `input_schema.type` stayed a wide union rather than the literal
>    `"object"` that `BetaTool.InputSchema` requires, so the whole tool array was
>    **unassignable to `toolRunner`'s `tools`** — invisible to every runtime test,
>    and it would only have surfaced at Task 7's call site. Fixed by narrowing
>    after the runtime guard, and pinned by a compile-time assertion in
>    `tools.test.ts` (mutation-checked: reverting the narrowing yields exactly one
>    error, at the guard).
> 2. `reused: "ref"` hoisted `symbol` into a single-use `$defs` entry containing
>    nothing but `{"type":"string"}` — request tokens for no benefit. Dropped.
>
> Read `lib/assistant/tools.ts` for the real implementation. Keep Step 1's tests;
> they all still apply.

**Files:**
- Create: `lib/assistant/tools.ts`
- Test: `lib/assistant/tools.test.ts`

**Read first:** `lib/mcp/tools.ts` (the six functions and their exported Zod schemas) and `app/api/mcp/route.ts` (the tool descriptions, which are reused verbatim so the two surfaces describe the tools identically).

- [ ] **Step 1: Write the failing tests**

Create `lib/assistant/tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon-key";

const { assistantTools, TOOL_NAMES } = await import("./tools");

const CTX = {
  userId: "u1",
  token: "tok",
  clientId: "port-pulse-app",
  scopes: [] as string[],
};

describe("assistantTools", () => {
  it("exposes exactly the six read-only MCP tools", () => {
    const names = assistantTools(CTX).map((t) => t.name).sort();
    expect(names).toEqual([
      "get_portfolio",
      "get_position",
      "get_price_history",
      "get_risk_metrics",
      "get_sector_breakdown",
      "list_portfolios",
    ]);
  });

  it("keeps TOOL_NAMES in step with the definitions", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      assistantTools(CTX).map((t) => t.name).sort(),
    );
  });

  it("gives every tool a non-trivial description", () => {
    // These are what the model reads to decide when to call a tool. A stub
    // description is a silent capability regression.
    for (const tool of assistantTools(CTX)) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it("exposes no tool that could mutate state", () => {
    // Item 6 of the backlog is a hard boundary. Assert it structurally rather
    // than trusting that nobody adds a write tool later.
    const forbidden = /add|create|update|delete|remove|set|buy|sell|place|order/i;
    for (const name of TOOL_NAMES) {
      expect(name).not.toMatch(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- lib/assistant/tools.test.ts`
Expected: FAIL — cannot resolve `./tools`.

- [ ] **Step 3: Implement**

Create `lib/assistant/tools.ts`:

```ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { McpAuthContext } from "@/lib/mcp/auth";
import {
  getPortfolio,
  getPortfolioSchema,
  getPosition,
  getPositionSchema,
  getPriceHistory,
  getPriceHistorySchema,
  getRiskMetrics,
  getRiskMetricsSchema,
  getSectorBreakdown,
  getSectorBreakdownSchema,
  listPortfolios,
  listPortfoliosSchema,
} from "@/lib/mcp/tools";

/**
 * Every tool the assistant can reach. All six are read-only, which is how the
 * "analysis only, never writes" constraint is satisfied — structurally, by the
 * absence of a write path, rather than by instruction.
 */
export const TOOL_NAMES = [
  "list_portfolios",
  "get_portfolio",
  "get_position",
  "get_price_history",
  "get_risk_metrics",
  "get_sector_breakdown",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Tool results go back to the model as JSON text, as the MCP route does. */
function asText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Bind the six MCP tool functions to one user's context.
 *
 * Descriptions are copied from `app/api/mcp/route.ts` on purpose: the remote
 * connector and the in-app assistant should describe the same tool the same
 * way, and divergence there is invisible until the model starts choosing badly.
 */
export function assistantTools(ctx: McpAuthContext) {
  return [
    betaZodTool({
      name: "list_portfolios",
      description:
        "List the signed-in user's Port Pulse portfolios with a holdings count.",
      inputSchema: listPortfoliosSchema,
      run: async () => asText(await listPortfolios(ctx)),
    }),
    betaZodTool({
      name: "get_portfolio",
      description:
        "Get one portfolio's holdings with current prices, unrealized P&L and " +
        "weights. Identify it by portfolio_id, or by name if you already " +
        "listed portfolios.",
      inputSchema: getPortfolioSchema,
      run: async (args) => asText(await getPortfolio(ctx, args)),
    }),
    betaZodTool({
      name: "get_position",
      description:
        "Get the user's total exposure to one ticker, aggregated across every " +
        "portfolio.",
      inputSchema: getPositionSchema,
      run: async (args) => asText(await getPosition(ctx, args)),
    }),
    betaZodTool({
      name: "get_price_history",
      description:
        "Get a price history series for one ticker over 1D, 1M, 3M, YTD, 1Y or 5Y.",
      inputSchema: getPriceHistorySchema,
      run: async (args) => asText(await getPriceHistory(ctx, args)),
    }),
    betaZodTool({
      name: "get_risk_metrics",
      description:
        "Get Sharpe ratio, beta, annualized volatility and max drawdown for a " +
        "portfolio over the last year, benchmarked against SPY.",
      inputSchema: getRiskMetricsSchema,
      run: async (args) => asText(await getRiskMetrics(ctx, args)),
    }),
    betaZodTool({
      name: "get_sector_breakdown",
      description:
        "Break a portfolio down by sector, with value, percentage and " +
        "constituent tickers.",
      inputSchema: getSectorBreakdownSchema,
      run: async (args) => asText(await getSectorBreakdown(ctx, args)),
    }),
  ];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/assistant/tools.test.ts`
Expected: PASS, 4 tests.

If the import of `lib/mcp/tools.ts` pulls in `server-only` and throws under vitest, the `vi.mock("server-only")` at the top of the test is the fix — it is already there, following `lib/mcp/endpoint.test.ts`. If it still fails, report rather than working around it.

- [ ] **Step 5: Type check, lint, full suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean; total rises to 95 (80 + 3 + 7 + 5, including the assignability guard).

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/tools.ts lib/assistant/tools.test.ts
git commit -m "feat(assistant): six read-only tools over the unchanged MCP layer

Reuses lib/mcp/tools.ts functions, its exported Zod schemas, and the MCP
route's descriptions verbatim, so the connector and the assistant cannot
describe the same tool differently."
```

---

## Task 5: System prompt and starter prompts

**Files:**
- Create: `lib/assistant/prompts.ts`
- Test: `lib/assistant/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/assistant/prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STARTER_PROMPTS, buildSystemPrompt, pickStarters } from "./prompts";

describe("STARTER_PROMPTS", () => {
  it("has 15 unique prompts", () => {
    expect(STARTER_PROMPTS).toHaveLength(15);
    expect(new Set(STARTER_PROMPTS).size).toBe(15);
  });

  it("asks no prompt that solicits a transaction", () => {
    // The app is analysis-only; a starter that invites trade advice would be
    // the product contradicting its own constraint on the first screen.
    const forbidden = /should i (buy|sell)|what should i buy|place an order/i;
    for (const p of STARTER_PROMPTS) expect(p).not.toMatch(forbidden);
  });
});

describe("pickStarters", () => {
  it("returns the requested count, without repeats", () => {
    const picked = pickStarters(3, () => 0.5);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
  });

  it("only returns real prompts", () => {
    for (const p of pickStarters(3, () => 0.1)) {
      expect(STARTER_PROMPTS).toContain(p);
    }
  });

  it("varies with the random source", () => {
    const a = pickStarters(3, () => 0);
    const b = pickStarters(3, () => 0.99);
    expect(a).not.toEqual(b);
  });

  it("clamps a count larger than the pool", () => {
    expect(pickStarters(99, () => 0.5)).toHaveLength(15);
  });
});

describe("buildSystemPrompt", () => {
  it("names the portfolio the user is looking at", () => {
    expect(buildSystemPrompt({ activePortfolioName: "Main" })).toContain("Main");
  });

  it("works without an active portfolio", () => {
    const p = buildSystemPrompt({ activePortfolioName: null });
    expect(p.length).toBeGreaterThan(100);
    expect(p).not.toContain("null");
  });

  it("states the read-only boundary and forbids remembered numbers", () => {
    const p = buildSystemPrompt({ activePortfolioName: "Main" });
    expect(p).toMatch(/never place|do not place|read-only|analysis only/i);
    // Prices move between turns; a number recalled from an earlier turn is a
    // wrong number. This instruction is load-bearing, not decoration.
    expect(p).toMatch(/tool/i);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- lib/assistant/prompts.test.ts`
Expected: FAIL — cannot resolve `./prompts`.

- [ ] **Step 3: Implement**

Create `lib/assistant/prompts.ts`:

```ts
/**
 * Starter prompts for an empty conversation. All are answerable from the six
 * tools, and none invites trade advice — the app is analysis-only.
 */
export const STARTER_PROMPTS: readonly string[] = [
  "What are my biggest risks right now?",
  "How concentrated is this portfolio?",
  "How diversified am I by sector?",
  "What's driving today's moves?",
  "If the market dropped 10%, which positions would hurt most?",
  "Which of my holdings duplicate each other's exposure?",
  "What's my best and worst performer?",
  "How have I done against the S&P 500 this year?",
  "Is my beta what I'd expect from these holdings?",
  "Which positions contribute most to my volatility?",
  "Walk me through my sector allocation.",
  "Summarise this portfolio for someone seeing it for the first time.",
  "What's changed most in the last month?",
  "How much of my gain comes from a single holding?",
  "What should I understand about this portfolio that isn't obvious?",
] as const;

/**
 * Pick `count` distinct starters.
 *
 * `random` is injected so this is testable and so the caller controls *when*
 * randomness happens — it must not run during render, or the server and client
 * markup disagree and React reports a hydration mismatch.
 */
export function pickStarters(
  count: number,
  random: () => number = Math.random,
): string[] {
  const pool = [...STARTER_PROMPTS];
  const take = Math.min(count, pool.length);
  const out: string[] = [];
  for (let i = 0; i < take; i++) {
    const idx = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * The system prompt has four jobs: frame which portfolio the user is looking
 * at, force every number through a tool, state the read-only boundary, and
 * keep the answer short. This model defaults verbose.
 */
export function buildSystemPrompt(args: {
  activePortfolioName: string | null;
}): string {
  const viewing = args.activePortfolioName
    ? `The user is currently looking at their portfolio named "${args.activePortfolioName}". ` +
      `Assume questions are about that portfolio unless they say otherwise.`
    : `The user has not selected a portfolio. Call list_portfolios first to see what they have.`;

  return [
    "You are the Port Pulse assistant. You help one person understand their own investment portfolio.",
    "",
    viewing,
    "",
    "Grounding. Every number you state must come from a tool call in this turn.",
    "Never reuse a figure from an earlier turn: prices move, so a remembered",
    "number is a wrong number. If a tool fails, say which one and what you could",
    "not determine — do not estimate around it.",
    "",
    "Boundaries. Port Pulse is read-only and for analysis only. You cannot and",
    "must not place trades, move money, or change anything in the user's account.",
    "You can explain what a holding is, what the portfolio's exposures and risks",
    "are, and what the numbers mean. Do not tell the user what to buy or sell.",
    "",
    "Style. Lead with the answer, then the supporting detail. Keep it short —",
    "a sentence or two for a simple question. Use the ticker symbols the user",
    "uses. Format money and percentages the way a broker statement would.",
    "Do not restate the question back before answering it.",
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- lib/assistant/prompts.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/assistant/prompts.ts lib/assistant/prompts.test.ts
git commit -m "feat(assistant): system prompt and 15 starter prompts"
```

---

## Task 6: Persistence

**Files:**
- Create: `lib/assistant/persist.ts`
- Test: `lib/assistant/persist.test.ts`
- Modify: `types/index.ts`

- [ ] **Step 1: Add the types**

Append to `types/index.ts`:

```ts
export type AssistantRole = "user" | "assistant";

export type AssistantMessage = {
  id: string;
  role: AssistantRole;
  content: string;
  createdAt: string;
};

export type AssistantConversation = {
  id: string;
  title: string | null;
  updatedAt: string;
};
```

- [ ] **Step 2: Write the failing tests**

Only `deriveTitle` is pure and therefore testable here; the read/write functions are thin Supabase calls verified in the browser.

Create `lib/assistant/persist.test.ts`.

**`persist.ts` starts with `import "server-only"`, so a plain static import here
fails under vitest** — that package throws unless resolved through Next's bundler.
Stub it and import dynamically, exactly as `lib/mcp/auth.test.ts`,
`lib/mcp/endpoint.test.ts` and `lib/assistant/tools.test.ts` already do:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { deriveTitle, MAX_TITLE_LENGTH } = await import("./persist");

describe("deriveTitle", () => {
  it("uses the first message as-is when it is short", () => {
    expect(deriveTitle("What are my biggest risks?")).toBe(
      "What are my biggest risks?",
    );
  });

  it("collapses whitespace and newlines", () => {
    expect(deriveTitle("  how   diversified\nam I?  ")).toBe(
      "how diversified am I?",
    );
  });

  it("truncates long messages on a word boundary with an ellipsis", () => {
    const long =
      "Tell me everything about how concentrated this portfolio is and whether " +
      "I should be worried about the overlap between my index funds";
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
    expect(title.endsWith("…")).toBe(true);
    // No mid-word cut.
    expect(title.slice(0, -1).trimEnd()).toBe(title.slice(0, -1));
  });

  it("falls back for an empty or whitespace-only message", () => {
    expect(deriveTitle("")).toBe("New conversation");
    expect(deriveTitle("   \n  ")).toBe("New conversation");
  });

  it("handles a single word longer than the limit", () => {
    const title = deriveTitle("A".repeat(200));
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npm test -- lib/assistant/persist.test.ts`
Expected: FAIL — cannot resolve `./persist`.

- [ ] **Step 4: Implement**

Create `lib/assistant/persist.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantRole,
} from "@/types";

const CONVERSATIONS = "assistant_conversations";
const MESSAGES = "assistant_messages";

export const MAX_TITLE_LENGTH = 60;

/**
 * Title a conversation from its first user message rather than asking the model
 * for one — that would be an extra billed call on every new conversation for a
 * string nobody reads closely.
 */
export function deriveTitle(firstMessage: string): string {
  const clean = firstMessage.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  if (clean.length <= MAX_TITLE_LENGTH) return clean;

  const cut = clean.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > 20 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  firstMessage: string,
): Promise<string> {
  const { data, error } = await supabase
    .from(CONVERSATIONS)
    .insert({ user_id: userId, title: deriveTitle(firstMessage) })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function appendMessage(
  supabase: SupabaseClient,
  args: {
    conversationId: string;
    userId: string;
    role: AssistantRole;
    content: string;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from(MESSAGES)
    .insert({
      conversation_id: args.conversationId,
      user_id: args.userId,
      role: args.role,
      content: args.content,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Bump the conversation so the list orders by recency.
  await supabase
    .from(CONVERSATIONS)
    .update({ updated_at: new Date().toISOString() })
    .eq("id", args.conversationId);

  return String(data.id);
}

export async function loadMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<AssistantMessage[]> {
  const { data, error } = await supabase
    .from(MESSAGES)
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    role: r.role as AssistantRole,
    content: String(r.content),
    createdAt: String(r.created_at),
  }));
}

export async function listConversations(
  supabase: SupabaseClient,
): Promise<AssistantConversation[]> {
  const { data, error } = await supabase
    .from(CONVERSATIONS)
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    title: r.title == null ? null : String(r.title),
    updatedAt: String(r.updated_at),
  }));
}
```

Note there is no `user_id` filter on the reads — RLS supplies it. Adding one would be redundant and would imply the policy is not trusted.

- [ ] **Step 5: Run the tests**

Run: `npm test -- lib/assistant/persist.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/assistant/persist.ts lib/assistant/persist.test.ts types/index.ts
git commit -m "feat(assistant): conversation and message persistence"
```

---

## Task 7: The tool-runner loop

**Files:**
- Create: `lib/assistant/loop.ts`

Not unit-tested: it is a thin adapter over the SDK whose behaviour is the SDK's. It is exercised end-to-end in Task 8's manual verification.

- [ ] **Step 1: Implement**

Create `lib/assistant/loop.ts`:

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { McpAuthContext } from "@/lib/mcp/auth";
import { assistantTools } from "./tools";
import { buildSystemPrompt } from "./prompts";
import type { AssistantEvent } from "./protocol";
import type { AssistantMessage } from "@/types";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 8192;

const client = new Anthropic();

/**
 * Run one assistant turn, yielding protocol events as they happen.
 *
 * Yields `tool` events because a tool loop plus thinking means several seconds
 * before the first token; without them the user watches a blank pane.
 *
 * The returned generator also accumulates the assistant's text, which the
 * caller persists — see the `text` events it emits.
 */
export async function* runAssistantTurn(args: {
  ctx: McpAuthContext;
  history: AssistantMessage[];
  activePortfolioName: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<AssistantEvent> {
  const runner = client.beta.messages.toolRunner(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      // Adaptive thinking is on by default on Opus 5, so there is no `thinking`
      // param here — `budget_tokens` is rejected outright on this model. High
      // effort is what buys multi-step tool reasoning ("compare these two
      // portfolios" is several dependent calls, not one).
      output_config: { effort: "high" },
      system: [
        {
          type: "text",
          text: buildSystemPrompt({
            activePortfolioName: args.activePortfolioName,
          }),
          // Tools serialize before `system`, which serializes before the
          // messages, so one breakpoint here caches the whole stable prefix —
          // measured at ~975 tokens (2442 chars of tool definitions + 1068 of
          // system prompt), comfortably clear of this model's 512-token
          // minimum. It pays on every turn after the first.
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: assistantTools(args.ctx),
      messages: args.history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      // Opus 5 can decline via its safety classifiers. Routing the retry
      // server-side means a decline is recovered rather than shown as a dead end.
      //
      // `fallbacks` appears nowhere in @anthropic-ai/sdk 0.95.1's resource
      // types, so it is introduced by spread rather than by asserting the whole
      // params object. Spread properties skip TypeScript's excess-property
      // check, which keeps every field above fully type-checked; a blanket
      // `as Parameters<typeof client.beta.messages.toolRunner>[0]` would have
      // suppressed errors on `tools`, `system` and `messages` as well.
      ...{ fallbacks: "default" },
    },
    {
      // The beta rides the header rather than a body `betas` key.
      // `BetaToolRunnerParams` derives from the **non-beta**
      // `MessageCreateParams` (BetaToolRunner.d.ts:144) so it has no `betas`
      // field — but `BetaToolRunnerRequestOptions` is
      // `Pick<RequestOptions, 'headers' | 'signal'>`, so this is fully typed.
      headers: { "anthropic-beta": "server-side-fallback-2026-07-01" },
      signal: args.signal,
    },
  );

  // Tools named in one model turn have been executed by the time the next turn
  // begins — that is when we can honestly report them done.
  let pending: string[] = [];

  for await (const messageStream of runner) {
    for (const name of pending) {
      yield { kind: "tool", name, status: "done" };
    }
    pending = [];

    for await (const event of messageStream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { kind: "text", delta: event.delta.text };
      }
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        pending.push(event.content_block.name);
        yield { kind: "tool", name: event.content_block.name, status: "running" };
      }
    }

    const message = await messageStream.finalMessage();
    // Check before trusting content: a refused message can be empty.
    if (message.stop_reason === "refusal") {
      yield {
        kind: "error",
        message:
          "I can't help with that one. Try rephrasing, or ask about a different part of the portfolio.",
      };
      return;
    }
  }

  for (const name of pending) {
    yield { kind: "tool", name, status: "done" };
  }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

All of this was verified against the installed SDK before the plan was written, so it should compile as-is:

| Thing | Status in `@anthropic-ai/sdk` 0.95.1 |
|---|---|
| `output_config: { effort: "high" }` | Fully typed — `OutputConfig.effort` is `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max' \| null` (`resources/messages/messages.d.ts:800`) |
| `fallbacks` | **Absent from the types.** Carried by spread, which needs no assertion |
| `betas` | Absent — `BetaToolRunnerParams` wraps the non-beta `MessageCreateParams`. Use the header instead |
| `{ headers, signal }` 2nd arg | Fully typed — `BetaToolRunnerRequestOptions = Pick<RequestOptions, 'headers' \| 'signal'>` |

**Do not add a type assertion to make this compile.** If it does not compile, report the exact error — a cast here would suppress errors on `tools`, `system` and `messages` too, which is the opposite of what we want.

- [ ] **Step 3: Commit**

```bash
git add lib/assistant/loop.ts
git commit -m "feat(assistant): streaming tool-runner loop with refusal fallback"
```

---

## Task 8: The API route

**Files:**
- Create: `app/api/assistant/route.ts`

- [ ] **Step 1: Implement**

Create `app/api/assistant/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { mcpContextFromSession } from "@/lib/assistant/context";
import { runAssistantTurn } from "@/lib/assistant/loop";
import { encodeEvent } from "@/lib/assistant/protocol";
import {
  appendMessage,
  createConversation,
  loadMessages,
} from "@/lib/assistant/persist";

export const runtime = "nodejs";
export const maxDuration = 120;

type RequestBody = {
  message?: unknown;
  conversationId?: unknown;
  activePortfolioName?: unknown;
};

/**
 * Best-effort guard against an accidental double-submit on a paid endpoint.
 *
 * Module state does not survive across serverless instances, so this is not a
 * rate limit and must not be mistaken for one — the disabled composer is the
 * real first line, and IDEAS #12 owns proper limiting.
 */
const inFlight = new Set<string>();

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message =
    typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  // `getUser()` validates the JWT against Supabase and is the authentication
  // step. `getSession()` only reads cookies, so on its own it authenticates
  // nothing — it is called purely for `access_token`.
  //
  // The order matters and is not interchangeable: `getUser()` first means an
  // expired token has already been refreshed by the time `getSession()` reads
  // it, so the token handed to the tools is the fresh one. Reversing these two
  // calls can hand the MCP layer a token that is about to expire mid-turn.
  //
  // No other route in this codebase calls `getSession()` — this is the first,
  // because it is the only place that needs the raw token rather than just the
  // identity.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (inFlight.has(user.id)) {
    return NextResponse.json(
      { error: "A message is already in progress" },
      { status: 409 },
    );
  }

  const activePortfolioName =
    typeof body.activePortfolioName === "string" &&
    body.activePortfolioName.trim()
      ? body.activePortfolioName.trim().slice(0, 80)
      : null;

  let conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;

  inFlight.add(user.id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) =>
        controller.enqueue(encoder.encode(chunk));
      let assistantText = "";

      try {
        if (!conversationId) {
          conversationId = await createConversation(supabase, user.id, message);
        }
        await appendMessage(supabase, {
          conversationId,
          userId: user.id,
          role: "user",
          content: message,
        });

        const history = await loadMessages(supabase, conversationId);

        for await (const event of runAssistantTurn({
          ctx: mcpContextFromSession(user.id, session.access_token),
          history,
          activePortfolioName,
          signal: request.signal,
        })) {
          if (event.kind === "text") assistantText += event.delta;
          send(encodeEvent(event));
        }

        // Persist whatever was produced, even a partial answer — a dropped
        // stream should leave a visible transcript, not a gap.
        const messageId = assistantText
          ? await appendMessage(supabase, {
              conversationId,
              userId: user.id,
              role: "assistant",
              content: assistantText,
            })
          : "";

        send(encodeEvent({ kind: "done", conversationId, messageId }));
      } catch (err) {
        send(
          encodeEvent({
            kind: "error",
            message:
              err instanceof Error ? err.message : "The assistant failed",
          }),
        );
      } finally {
        inFlight.delete(user.id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Gates**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean; 109 tests. The build matters — this route imports `server-only` modules.

- [ ] **Step 3: Exercise it by hand**

Start `npm run dev`. First confirm it refuses an unauthenticated caller:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/assistant \
  -H 'content-type: application/json' -d '{"message":"hi"}'
```

Expected: `401`. (`{ error: "Unauthorized" }` matches `app/api/watchlist/route.ts`; the client maps the status itself, so this body text is only ever seen by curl.)

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/assistant \
  -H 'content-type: application/json' -d '{}'
```

Expected: `400`.

Then, **signed in via the browser** (the route is cookie-authenticated, so curl cannot easily reach the happy path — use the app once Task 9 lands, or copy the session cookies). Report which you did rather than claiming a check you could not run.

- [ ] **Step 4: Commit**

```bash
git add app/api/assistant/route.ts
git commit -m "feat(assistant): authenticated SSE endpoint"
```

---

## Task 9: The page and chat UI

**Files:**
- Create: `app/assistant/page.tsx`
- Create: `components/assistant/AssistantView.tsx`
- Create: `components/assistant/MessageList.tsx`
- Create: `components/assistant/Composer.tsx`
- Create: `components/assistant/SuggestionChips.tsx`
- Create: `components/assistant/SignInPrompt.tsx`
- Modify: `lib/assistant/prompts.ts` + `lib/assistant/prompts.test.ts` (Step 0)

- [ ] **Step 0: Stop the model emitting markdown**

`MessageList` renders assistant text with `whitespace-pre-wrap` — no markdown
parser. The project has no markdown dependency and adding one would break the
"no external UI component libraries, custom components only" rule for something
the prompt can prevent outright. So constrain the output instead of parsing it.

Add this to the `Style.` block returned by `buildSystemPrompt` in
`lib/assistant/prompts.ts`:

```ts
    "Write plain prose — the interface renders your text as-is and does not",
    "interpret markdown, so asterisks, underscores and hash headings would show",
    "up literally. For a list, use short lines each beginning with a hyphen.",
```

And pin it in `lib/assistant/prompts.test.ts`, inside the existing
`describe("buildSystemPrompt", …)`:

```ts
  it("tells the model not to emit markdown", () => {
    // MessageList has no markdown parser, so `**bold**` would render literally.
    // This instruction is the only thing preventing that.
    expect(buildSystemPrompt({ activePortfolioName: "Main" })).toMatch(
      /plain prose|markdown/i,
    );
  });
```

Run `npm test -- lib/assistant/prompts.test.ts` → 10 tests pass. Commit this
separately before starting the UI:

```
feat(assistant): keep model output free of markdown

MessageList renders text as-is with no parser, so unrendered ** and #
would leak into the transcript. Constraining the prompt is cheaper and
smaller than adding a markdown dependency this project deliberately
does not have.
```

> **AMENDED DURING EXECUTION.** Two things the plan's code got wrong, both fixed
> in `e77e6ba` / follow-up:
>
> 1. **`SuggestionChips` fails `npm run lint` as written.** React Compiler's
>    `react-hooks/set-state-in-effect` rejects the synchronous `setPrompts` in the
>    effect body. The effect is the entire point — randomising during render
>    desyncs server and client markup — so the shipped file carries a one-line
>    `eslint-disable-next-line` with a justification. Precedent:
>    `app/compare/CompareView.tsx:128`.
> 2. **The height `calc` was off by 1px.** `h-14` is 56px but `border-b` sits on
>    the Navbar's outer element, so the real bar is 57px; the original calc left
>    `main` ending 1px past the fold. Now `3.5rem - 1px`.

Design direction: Claude's chat layout, Port Pulse's skin. Dark-first, monospace for data, no generic template look. Follow `CLAUDE.md`'s design direction.

- [ ] **Step 1: The route shell**

Create `app/assistant/page.tsx`:

Matching `app/compare/page.tsx` exactly — a plain metadata object with no `Metadata`
type import, and an **em dash** separator, not a middle dot:

```tsx
import { AssistantView } from "@/components/assistant/AssistantView";

export const metadata = {
  title: "Assistant — Port Pulse",
};

export default function AssistantPage() {
  return <AssistantView />;
}
```

(The view lives under `components/assistant/` rather than colocated as
`app/compare/CompareView.tsx` does, because it mirrors `components/insights/` —
the surface it replaces — and because there are six files, not one.)

- [ ] **Step 2: Suggestion chips**

Create `components/assistant/SuggestionChips.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { pickStarters } from "@/lib/assistant/prompts";

type Props = { onPick: (prompt: string) => void };

export function SuggestionChips({ onPick }: Props) {
  // Picked after mount, never during render: randomising in render would make
  // the server and client markup disagree.
  const [prompts, setPrompts] = useState<string[]>([]);
  useEffect(() => {
    setPrompts(pickStarters(3));
  }, []);

  if (prompts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="rounded-lg border border-slate-300 px-3 py-2.5 text-left font-mono text-[13px] text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-900/60"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Message list**

Create `components/assistant/MessageList.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "@/types";

type Props = {
  messages: AssistantMessage[];
  streaming: string;
  runningTool: string | null;
};

const TOOL_LABELS: Record<string, string> = {
  list_portfolios: "looking at your portfolios",
  get_portfolio: "reading your holdings",
  get_position: "checking that position",
  get_price_history: "pulling price history",
  get_risk_metrics: "computing risk metrics",
  get_sector_breakdown: "breaking down sectors",
};

export function MessageList({ messages, streaming, runningTool }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming, runningTool]);

  return (
    <div className="flex flex-col gap-5">
      {messages.map((m) => (
        <Bubble key={m.id} role={m.role} content={m.content} />
      ))}
      {streaming && <Bubble role="assistant" content={streaming} />}
      {runningTool && (
        <div
          role="status"
          className="font-mono text-[11px] uppercase tracking-widest text-slate-500"
        >
          {TOOL_LABELS[runningTool] ?? runningTool}…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function Bubble({ role, content }: { role: string; content: string }) {
  if (role === "user") {
    return (
      <div className="self-end rounded-2xl bg-slate-900 px-4 py-2.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
        {content}
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      {content}
    </div>
  );
}
```

- [ ] **Step 4: Composer**

Create `components/assistant/Composer.tsx`:

```tsx
"use client";

import { useState } from "react";

type Props = {
  busy: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
};

export function Composer({ busy, onSend, onStop }: Props) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    onSend(text);
  }

  return (
    <div
      className="flex items-end gap-2 border-t border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/80"
      // py-3 is 0.75rem; the inset keeps the buttons clear of the iOS home
      // indicator in standalone mode, where it is non-zero.
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="Ask about your portfolio…"
        aria-label="Message"
        // 16px below lg: anything smaller makes iOS Safari zoom on focus.
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-base text-slate-900 outline-none transition-colors focus:border-emerald-500 lg:text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-emerald-400"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-4 font-mono text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-4 font-mono text-xs font-medium text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          Send
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Sign-in prompt**

Create `components/assistant/SignInPrompt.tsx`:

```tsx
"use client";

import { signInWithGoogle } from "@/lib/auth";

export function SignInPrompt() {
  return (
    <div className="mx-auto max-w-sm px-6 py-20 text-center">
      <h1 className="font-mono text-sm font-medium text-slate-800 dark:text-slate-200">
        Sign in to use the assistant
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        The assistant reads your saved portfolios to answer questions about
        them, so it needs an account. It only ever reads — it can&apos;t place
        trades or change anything.
      </p>
      <button
        type="button"
        // `next` sends OAuth back here rather than to the dashboard, so the
        // user lands on the thing they were trying to use.
        onClick={() => void signInWithGoogle("/assistant")}
        className="mt-5 inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-4 font-mono text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Sign in with Google
      </button>
    </div>
  );
}
```

`signInWithGoogle(next?: string)` is verified to exist at `lib/auth.ts:64`, and `getUser` / `getUserServerSnapshot` / `subscribeUser` / `isAuthReady` alongside it.

- [ ] **Step 6: The view**

Create `components/assistant/AssistantView.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  getUser,
  getUserServerSnapshot,
  isAuthReady,
  subscribeUser,
} from "@/lib/auth";
import {
  getActiveIdServerSnapshot,
  getActivePortfolioId,
  getPortfolios,
  getPortfoliosServerSnapshot,
  subscribeActivePortfolio,
  subscribePortfolios,
} from "@/lib/portfolios";
import { createEventDecoder } from "@/lib/assistant/protocol";
import type { AssistantMessage } from "@/types";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { SuggestionChips } from "./SuggestionChips";
import { SignInPrompt } from "./SignInPrompt";

export function AssistantView() {
  const user = useSyncExternalStore(
    subscribeUser,
    getUser,
    getUserServerSnapshot,
  );
  // Auth readiness must be its OWN subscribed snapshot, not a plain
  // `isAuthReady()` call during render.
  //
  // `getUser()` returns null both while the initial auth fetch is in flight and
  // when the user is genuinely signed out. Branching on `user` alone therefore
  // flashes the sign-in prompt at every signed-in visitor — the same
  // loading-mistaken-for-empty bug that `isWatchlistLoading()` exists to fix.
  //
  // And reading `isAuthReady()` inline would not work either: for a signed-out
  // user the snapshot is null before and after `lib/auth.ts`'s `emit()`, so
  // `useSyncExternalStore` sees no change and never re-renders — the pane would
  // sit on "loading" forever. `isAuthReady` as its own snapshot flips
  // false → true, which does re-render.
  const authReady = useSyncExternalStore(
    subscribeUser,
    isAuthReady,
    () => false,
  );
  const portfolios = useSyncExternalStore(
    subscribePortfolios,
    getPortfolios,
    getPortfoliosServerSnapshot,
  );
  const activeId = useSyncExternalStore(
    subscribeActivePortfolio,
    getActivePortfolioId,
    getActiveIdServerSnapshot,
  );

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activePortfolioName =
    portfolios.find((p) => p.id === activeId)?.name ?? null;

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setStreaming("");
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${prev.length}`,
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
        },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let accumulated = "";

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId: conversationId.current,
            activePortfolioName,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(
            res.status === 401
              ? "Sign in required"
              : `Request failed (${res.status})`,
          );
        }

        const decode = createEventDecoder();
        const reader = res.body.getReader();
        const textDecoder = new TextDecoder();

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of decode(textDecoder.decode(value, { stream: true }))) {
            if (event.kind === "text") {
              accumulated += event.delta;
              setStreaming(accumulated);
            } else if (event.kind === "tool") {
              setRunningTool(event.status === "running" ? event.name : null);
            } else if (event.kind === "done") {
              conversationId.current = event.conversationId;
            } else if (event.kind === "error") {
              accumulated += (accumulated ? "\n\n" : "") + event.message;
              setStreaming(accumulated);
            }
          }
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          accumulated +=
            (accumulated ? "\n\n" : "") +
            (err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            {
              id: `local-a-${prev.length}`,
              role: "assistant",
              content: accumulated,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
        setStreaming("");
        setRunningTool(null);
        setBusy(false);
        abortRef.current = null;
      }
    },
    [activePortfolioName],
  );

  // Order matters: readiness first, identity second.
  if (!authReady) {
    return (
      <div
        className="mx-auto w-full max-w-3xl px-4 py-10"
        style={{ height: "calc(100dvh - 3.5rem - 1px - env(safe-area-inset-top))" }}
      >
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }
  if (!user) return <SignInPrompt />;

  const empty = messages.length === 0 && !streaming;

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col"
      // Three things come off the viewport: the Navbar's inner `h-14`
      // (as 3.5rem, so it tracks text scaling per WCAG 1.4.4 rather than
      // drifting), its `border-b` — which sits on the OUTER element, making the
      // real bar 57px not 56 — and its own `env(safe-area-inset-top)`, without
      // which the composer lands under the fold on a notched device.
      //
      // At lg this leaves the root layout's footer one footer-height below the
      // fold. That is the accepted cost of a transcript that scrolls on its own
      // rather than scrolling the document; the footer is `hidden` below lg,
      // which is the width that matters here.
      style={{ height: "calc(100dvh - 3.5rem - 1px - env(safe-area-inset-top))" }}
    >
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {empty ? (
          <div className="mx-auto max-w-md pt-10">
            <h1 className="font-mono text-sm uppercase tracking-widest text-slate-500">
              Assistant
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Ask anything about
              {activePortfolioName ? ` ${activePortfolioName}` : " your portfolios"}.
            </p>
            <div className="mt-6">
              <SuggestionChips onPick={(p) => void send(p)} />
            </div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            streaming={streaming}
            runningTool={runningTool}
          />
        )}
      </div>
      <Composer
        busy={busy}
        onSend={(m) => void send(m)}
        onStop={() => abortRef.current?.abort()}
      />
    </main>
  );
}
```

**Note the deliberate gap:** this loads no prior conversation on mount. Restoring the last transcript needs a `GET /api/assistant/conversations` endpoint; it is **Task 11**, kept separate so this task can be verified on its own.

- [ ] **Step 7: Gates**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean, 109 tests.

- [ ] **Step 8: Browser verification**

`npm run dev`, signed in, visit `/assistant`.

Report each individually:
1. Empty state shows three starter prompts; **reload changes which three**.
2. Tapping a starter sends it. Text streams in.
3. A tool-using question (`Is my beta what I'd expect from these holdings?`) shows a tool status line, then an answer citing **real numbers matching the dashboard's risk panel**.
4. A cross-portfolio question (`Which of my portfolios has more tech exposure?`) — the old report could not answer this at all.
5. Stop mid-stream: streaming halts, partial text is kept.
6. Signed out (or with cookies cleared): the sign-in prompt renders.
7. **Signed in, hard reload: the sign-in prompt must never flash.** Throttle the network in DevTools to make the auth fetch slow enough to observe. Seeing "Sign in to use the assistant" appear and then vanish means the `authReady` gate is not working — report it rather than dismissing it as fast enough not to matter.
8. 393px in an iframe: the composer is usable and does not zoom on focus.
9. No console errors, no hydration warnings.

- [ ] **Step 9: Commit**

```bash
git add app/assistant components/assistant
git commit -m "feat(assistant): chat page"
```

---

## Task 10: Retire the old AI surfaces

Deliberately last, so the branch always has a working AI path.

**Files:**
- Delete: `components/InsightsDrawer.tsx`, `components/insights/useInsights.ts`, `components/insights/stream.ts`, `components/insights/SectionCard.tsx`, `components/mobile/sheet/InsightsTab.tsx`, `lib/insights.ts`, `app/api/insights/route.ts`
- Modify: `components/WatchlistDashboard.tsx`

- [ ] **Step 1: Repoint the dashboard**

In `components/WatchlistDashboard.tsx` — verified line numbers on `main`, and `Link` is **already imported** at line 33, so no import to add:

| Line | Change |
|---|---|
| 44 | Delete `import { InsightsDrawer } from "./InsightsDrawer";` |
| 51 | Delete `import { InsightsTab } from "./mobile/sheet/InsightsTab";` |
| 93 | Delete `const [insightsOpen, setInsightsOpen] = useState(false);` |
| 144–154 | The desktop Insights button → a `<Link>`. Exact replacement below |
| 211–215 | `<InsightsTab …/>` → the link card below. It is the final `else` of the sheet's 4-way tab ternary (lines 203–217) |
| 234–240 | Delete the whole `<InsightsDrawer open={insightsOpen} …/>` element |

**Do not remove `activeId` (line 85).** Deleting lines 214 and 240 removes two of its four usages, but line 123 still derives `activePortfolioName` from it. Likewise `activePortfolioName` keeps two usages (its own definition and `AddTickerModal` at line 232). Neither becomes orphaned — verified before this plan was written.

`SparkIcon` is a local function in this same file (line 321) and **stays** — the new `Link` uses it. If removing `insightsOpen` leaves `useState` unused, drop it from the React import; if other state still uses it, leave it.

The lines 144–154 replacement. Note what is preserved: the `isDesktop &&` guard, every class, the `hidden sm:inline` label span. Only the element type, the destination, and the wording change — the button became navigation, and it no longer opens "insights", it opens a conversation:

```tsx
              {/* Below lg the AI sheet tab links here instead. */}
              {isDesktop && (
                <Link
                  href="/assistant"
                  aria-label="Portfolio assistant"
                  title="Portfolio assistant"
                  className="inline-flex h-[30px] items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100 sm:px-2.5"
                >
                  <SparkIcon />
                  <span className="hidden sm:inline">Assistant</span>
                </Link>
              )}
```

This lands immediately above the existing `/compare` `<Link>` (lines 155–164), which is the same `h-[30px]` shape — use it as the reference if anything looks off.
- In the analytics sheet's tab switch, replace `<InsightsTab …/>` with a link card to `/assistant` — the sheet is a modal, and item 2's whole point is that the assistant is not one:

```tsx
                ) : (
                  <div className="py-6 text-center">
                    <Link
                      href="/assistant"
                      className="inline-flex min-h-[44px] items-center rounded-md border border-slate-300 px-4 font-mono text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                    >
                      Open the assistant →
                    </Link>
                    <p className="mt-3 font-mono text-[10px] text-slate-500">
                      Ask follow-up questions about this portfolio.
                    </p>
                  </div>
                )
```

- Remove the `InsightsTab` import.

- [ ] **Step 2: Delete the files**

```bash
git rm components/InsightsDrawer.tsx \
       components/insights/useInsights.ts \
       components/insights/stream.ts \
       components/insights/SectionCard.tsx \
       components/mobile/sheet/InsightsTab.tsx \
       lib/insights.ts \
       app/api/insights/route.ts
```

- [ ] **Step 3: Confirm nothing references them**

```bash
grep -rn "InsightsDrawer\|useInsights\|insights/stream\|SectionCard\|InsightsTab\|lib/insights\|api/insights" components app lib
```

Expected: no output. Also check `components/insights/` is now empty and remove the directory if so.

- [ ] **Step 4: Gates**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: clean. **Test count may drop** if any test referenced the deleted modules — report the number and which file, rather than assuming 94.

- [ ] **Step 5: Verify**

Desktop 1440: the Insights button navigates to `/assistant` instead of opening a drawer. Mobile 393: the sheet's AI tab shows the link card. Nothing else on either regressed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(assistant): retire the one-shot insights surfaces

Deletes InsightsDrawer, the insights components, lib/insights.ts and
/api/insights. This removes IDEAS #10 — the per-price-tick refetch — by
deleting the code that carried it rather than patching it.

Guests lose the report: /api/insights was the last unauthenticated AI path,
which is the accepted consequence of making the assistant authenticated."
```

---

## Task 11: Restore prior conversations

Split out so Task 9 was verifiable alone.

**Files:**
- Create: `app/api/assistant/conversations/route.ts`
- Modify: `components/assistant/AssistantView.tsx`

- [ ] **Step 1: The read endpoint**

Create `app/api/assistant/conversations/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { listConversations, loadMessages } from "@/lib/assistant/persist";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    return NextResponse.json(
      { messages: await loadMessages(supabase, id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json(
    { conversations: await listConversations(supabase) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
```

RLS scopes both reads, so an `id` belonging to another user returns an empty list rather than someone else's conversation. **Verify that specifically** in Step 3.

- [ ] **Step 2: Load the most recent conversation on mount**

In `AssistantView`, add after the existing state:

```tsx
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const listRes = await fetch("/api/assistant/conversations");
        if (!listRes.ok) return;
        const { conversations } = (await listRes.json()) as {
          conversations: { id: string }[];
        };
        const latest = conversations[0];
        if (!latest || cancelled) return;
        const msgRes = await fetch(
          `/api/assistant/conversations?id=${encodeURIComponent(latest.id)}`,
        );
        if (!msgRes.ok || cancelled) return;
        const { messages: loaded } = (await msgRes.json()) as {
          messages: AssistantMessage[];
        };
        if (cancelled) return;
        conversationId.current = latest.id;
        setMessages(loaded);
      } catch {
        // A failed restore leaves an empty chat, which is usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);
```

Add `useEffect` to the React import.

- [ ] **Step 3: Verify, including the isolation check**

- Send a message, reload: the transcript is restored.
- Gates: `npx tsc --noEmit && npm run lint && npm test && npm run build`.
- **Cross-user isolation.** With a conversation id belonging to your account, confirm a *different* account cannot read it: `GET /api/assistant/conversations?id=<other-users-id>` must return `{"messages":[]}`, not content. If you cannot access a second account, say so plainly and verify the policy in SQL instead (`select * from assistant_messages` as an anon role must return zero rows).

- [ ] **Step 4: Commit**

```bash
git add app/api/assistant/conversations components/assistant/AssistantView.tsx
git commit -m "feat(assistant): restore the most recent conversation on load"
```

---

## Task 12: Verification pass

No code unless something is broken. Use the `verify` skill.

- [ ] **Step 1: Everything**

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 2: The feature end to end**

At 393px (iframe) and 1440px:
1. Starter prompts rotate across reloads.
2. A tool-grounded answer whose numbers **match the dashboard** — cross-check risk metrics against the sheet's Risk tab.
3. A cross-portfolio question, which the retired report could not answer.
4. Follow-up question in the same conversation keeps context.
5. Reload restores the transcript.
6. Stop mid-stream keeps partial text.
7. Signed out: sign-in prompt; `/api/assistant` 401s.
8. Both themes; `prefers-reduced-motion`.
9. iOS input zoom: the composer computes 16px below `lg`.

- [ ] **Step 3: Regression sweep**

Dashboard at both widths, `/compare`, `/position/[symbol]`, the analytics sheet's four tabs, sort persistence. The Insights button navigates rather than opening a drawer.

- [ ] **Step 4: Report**

What was verified, what could not be, and the final test count. Two things to decide now that they can be seen with real data:

1. **Is the system prompt's conciseness instruction working**, or are answers still long? Adjust the prompt, not the code.
2. **Is the tool status line legible**, or does it flicker too fast to read on a fast connection?

- [ ] **Step 5: Push**

```bash
git push -u origin feat/assistant-chat
```

---

## Follow-ups (not in this plan)

- **Spec B: memory** — preferences, risk tolerance, conversation summaries, recall.
- **Graph retrieval** — deferred until there is a real corpus.
- **Deep-linking** `/assistant/[id]` and a conversation switcher UI.
- **Proper rate limiting** (`IDEAS.md` #12) — the in-flight guard is not one.
- **`lib/insights.ts` was the only `claude-opus-4-7` pin**; confirm no other stale model id survives.
